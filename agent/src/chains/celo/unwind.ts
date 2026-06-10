/**
 * Agent unwind: when an agent is culled (or the kill switch fires), its
 * entire portfolio returns to the treasury (orchestrator, HD index 0) —
 * the wallet it was funded from. Nothing stays behind except unavoidable
 * gas dust (<$0.01).
 *
 * Sequence per agent:
 *   1. withdraw every Aave position (USDC/USDT/USDm) in full
 *   2. swap every non-cUSD stable balance (EURm, BRLm, USDC, USDT) to cUSD
 *      via Mento, chunked to respect the $5 per-tx cap
 *   3. transfer the full cUSD balance to the treasury, minus a gas headroom
 *      computed from the fee-currency-denominated gas price (the same cUSD
 *      pays for the transfer's gas)
 *
 * Used by the Phase 4 cull path and the kill-switch handler. All steps are
 * logged with rationales.
 */

import { erc20Abi, formatUnits, type Address, type Hex } from "viem";
import type { HDAccount } from "viem/accounts";
import { FEE_CURRENCIES, TOKENS, TOKEN_DECIMALS, explorerTx } from "./addresses.js";
import { celoPublicClient, celoWalletClient } from "./chain.js";
import { AAVE_ASSETS, getAavePosition, withdrawFromAave, type AaveAsset } from "./aave.js";
import { executeSwap, quoteSwap } from "./mento.js";
import { MAX_TX_USD, assertTxAllowed } from "./budget.js";
import { logActivity } from "./activity-log.js";

/** Balances below this many token base-units are dust we don't bother moving. */
const DUST = {
  18: 10_000_000_000_000n, // 1e13 = $0.00001 at 18 decimals
  6: 10n, // $0.00001 at 6 decimals
} as const;

const SWEEPABLE_STABLES: Array<{ symbol: keyof typeof TOKENS; address: Address; decimals: 6 | 18 }> = [
  { symbol: "EURm", address: TOKENS.EURm, decimals: 18 },
  { symbol: "BRLm", address: TOKENS.BRLm, decimals: 18 },
  { symbol: "USDC", address: TOKENS.USDC, decimals: 6 },
  { symbol: "USDT", address: TOKENS.USDT, decimals: 6 },
];

export type UnwindResult = {
  agentId: string;
  txHashes: Hex[];
  sweptUsdm: bigint;
  treasury: Address;
};

async function balanceOf(token: Address, owner: Address): Promise<bigint> {
  return celoPublicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

/** Gas headroom in fee-currency units for one tx: units × price × 3 (buffer). */
async function gasHeadroom(feeCurrency: Address, gasUnits: bigint): Promise<bigint> {
  const price = await celoPublicClient.request<{
    method: "eth_gasPrice";
    params: [Address];
    ReturnType: `0x${string}`;
  }>({ method: "eth_gasPrice", params: [feeCurrency] });
  return gasUnits * BigInt(price) * 3n;
}

/**
 * Unwind one agent fully back to the treasury.
 * `liveFeeCurrency` false = fork test (gas in native CELO).
 */
export async function unwindAgentToTreasury(
  account: HDAccount,
  agentId: string,
  treasury: Address,
  reason: string,
  liveFeeCurrency = true,
): Promise<UnwindResult> {
  const txHashes: Hex[] = [];
  const feeUsdm = liveFeeCurrency ? FEE_CURRENCIES.USDm : undefined;

  // 1. pull everything out of Aave
  for (const asset of Object.keys(AAVE_ASSETS) as AaveAsset[]) {
    const pos = await getAavePosition(asset, account.address);
    if (pos <= DUST[AAVE_ASSETS[asset].decimals as 6 | 18]) continue;
    const usdValue = Number(formatUnits(pos, AAVE_ASSETS[asset].decimals));
    const hash = await withdrawFromAave(account, asset, "max", {
      agentId,
      usdValue: Math.min(usdValue, MAX_TX_USD), // position is capped at $5 by funding rules
      feeCurrency: feeUsdm,
      rationale: `Unwind (${reason}): withdraw full ${asset} position from Aave v3 so the balance can return to the treasury.`,
    });
    txHashes.push(hash);
  }

  // 2. swap every non-cUSD stable to cUSD, chunked under the per-tx cap
  for (const { symbol, address, decimals } of SWEEPABLE_STABLES) {
    let bal = await balanceOf(address, account.address);
    if (bal <= DUST[decimals]) continue;

    const fullQuote = await quoteSwap(address, TOKENS.USDm, bal);
    const fullUsd = Number(formatUnits(fullQuote, 18));
    const chunks = Math.max(1, Math.ceil(fullUsd / MAX_TX_USD));
    const chunkIn = bal / BigInt(chunks);

    for (let i = 0; i < chunks; i++) {
      const amountIn = i === chunks - 1 ? bal : chunkIn; // last chunk takes remainder
      if (amountIn <= DUST[decimals]) break;
      const res = await executeSwap({
        account,
        agentId,
        tokenIn: address,
        tokenOut: TOKENS.USDm,
        amountIn,
        tokenInDecimals: decimals,
        tokenOutDecimals: 18,
        usdValue: fullUsd / chunks,
        feeCurrency: liveFeeCurrency
          ? symbol === "USDC"
            ? FEE_CURRENCIES.USDC_ADAPTER
            : symbol === "USDT"
              ? FEE_CURRENCIES.USDT_ADAPTER
              : address // EURm/BRLm are direct fee currencies — gas in the token being swept
          : undefined,
        rationale: `Unwind (${reason}): convert ${formatUnits(amountIn, decimals)} ${symbol} to cUSD before returning funds to the treasury${chunks > 1 ? ` (chunk ${i + 1}/${chunks} under the $${MAX_TX_USD} per-tx cap)` : ""}.`,
      });
      txHashes.push(res.swapTxHash);
      bal -= amountIn;
    }
  }

  // 3. send the full cUSD balance home, leaving only gas headroom
  const usdmBal = await balanceOf(TOKENS.USDm, account.address);
  let swept = 0n;
  if (usdmBal > DUST[18]) {
    const headroom = liveFeeCurrency ? await gasHeadroom(FEE_CURRENCIES.USDm, 100_000n) : 0n;
    swept = usdmBal - headroom;
    if (swept > 0n) {
      const usdValue = Number(formatUnits(swept, 18));
      assertTxAllowed(Math.min(usdValue, MAX_TX_USD), `unwind sweep ${agentId}`);
      const wallet = celoWalletClient(account);
      const hash = await wallet.writeContract({
        address: TOKENS.USDm,
        abi: erc20Abi,
        functionName: "transfer",
        args: [treasury, swept],
        feeCurrency: feeUsdm,
      });
      const rcpt = await celoPublicClient.waitForTransactionReceipt({ hash });
      if (rcpt.status !== "success") throw new Error(`unwind sweep reverted: ${explorerTx(hash)}`);
      txHashes.push(hash);
      logActivity({
        agentId,
        action: "unwind-sweep",
        rationale: `Unwind (${reason}): return ${formatUnits(swept, 18)} cUSD to the treasury ${treasury} the agent was funded from. Gas paid from the same cUSD; only dust (<$0.01) remains in the retired wallet.`,
        txHash: hash,
        treasury,
        sweptUsdm: formatUnits(swept, 18),
      });
    }
  }

  return { agentId, txHashes, sweptUsdm: swept, treasury };
}
