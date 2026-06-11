/**
 * One-off ops script: replenish the treasury's USDC pool that funds x402
 * signal-budget top-ups (ensureSignalBudget draws 0.2 USDC per top-up).
 * Swaps treasury cUSD -> USDC via the Mento adapter (budget-railed, logged).
 *
 *   ALLOW_LIVE_REPLENISH=true npx tsx src/chains/celo/replenish-usdc-pool.ts
 */

import "./env.js";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { FEE_CURRENCIES, TOKENS } from "./addresses.js";
import { assertCeloMainnet, celoPublicClient, maybeFee } from "./chain.js";
import { orchestratorAccount } from "./wallets.js";
import { executeSwap } from "./mento.js";

const LIVE = /^(1|true|yes)$/i.test(process.env.ALLOW_LIVE_REPLENISH ?? "");
const TARGET_USDC = parseUnits("0.8", 6); // ~4 top-ups / ~400 signal calls
const MIN_CUSD_FLOAT = 0.4; // never drain the ops float below this

async function main() {
  await assertCeloMainnet();
  const treasury = orchestratorAccount();
  const [usdc, usdm] = await Promise.all([
    celoPublicClient.readContract({ address: TOKENS.USDC, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address] }),
    celoPublicClient.readContract({ address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address] }),
  ]);
  const usdmUsd = Number(formatUnits(usdm, 18));
  console.log(`treasury: ${formatUnits(usdc, 6)} USDC, ${usdmUsd.toFixed(4)} cUSD`);
  if (usdc >= TARGET_USDC) return void console.log("USDC pool already at target — nothing to do");

  const buyUsd = Math.min(
    Number(formatUnits(TARGET_USDC - usdc, 6)),
    Math.max(0, usdmUsd - MIN_CUSD_FLOAT),
  );
  if (buyUsd < 0.1) throw new Error(`cUSD float too small to replenish (have $${usdmUsd.toFixed(2)})`);
  if (!LIVE) return void console.log(`DRY-RUN: would swap $${buyUsd.toFixed(2)} cUSD -> USDC (set ALLOW_LIVE_REPLENISH=true)`);

  const res = await executeSwap({
    account: treasury,
    agentId: "orchestrator",
    tokenIn: TOKENS.USDm,
    tokenOut: TOKENS.USDC,
    amountIn: parseUnits(buyUsd.toFixed(6), 18),
    tokenInDecimals: 18,
    tokenOutDecimals: 6,
    usdValue: buyUsd,
    feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
    rationale: `Replenish the treasury's USDC pool ($${buyUsd.toFixed(2)} cUSD -> USDC) that funds x402 signal-budget top-ups for useSignal agents — the USDT buffer is exhausted. Ops capital, not trading capital; agent portfolios untouched.`,
  });
  console.log(`swapped: ${formatUnits(res.amountOut, 6)} USDC received (tx ${res.swapTxHash})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
