/**
 * One-time treasury setup: convert the developer-funded USDT on the
 * orchestrator into cUSD (USDm), the swarm's base currency, then seed
 * agent-1 for the Phase 1 smoke test.
 *
 * Respects the $5 per-tx cap by swapping in tranches; pre-approves the
 * exact total once (CLAUDE.md §8: batch approvals, don't emit 10
 * story-less approve txs). All gas paid in stablecoins via CIP-64 —
 * swaps in USDT (via its fee adapter), the final transfer in cUSD.
 *
 *   npm run treasury:celo                            # dry-run, prints plan
 *   ALLOW_LIVE_TREASURY=true npm run treasury:celo   # broadcast
 */

import "./env.js"; // must be first
import { erc20Abi, formatUnits, parseUnits, type Address, type Hex } from "viem";
import { FEE_CURRENCIES, TOKENS, explorerTx } from "./addresses.js";
import { assertCeloMainnet, celoPublicClient, celoWalletClient } from "./chain.js";
import { agentAccount, orchestratorAccount } from "./wallets.js";
import { MAX_TX_USD, assertTxAllowed } from "./budget.js";
import { getMento, quoteSwap, executeSwap } from "./mento.js";
import { logActivity } from "./activity-log.js";

const LIVE = /^(1|true|yes)$/i.test(process.env.ALLOW_LIVE_TREASURY ?? "");

const SWAP_TOTAL_USDT = 50; // stay at the $50 budget; remainder stays as buffer
const TRANCHE_USDT = 5; // per-tx cap compliance
const AGENT1_SEED_CUSD = 1; // Phase 1 smoke test seed

async function main() {
  await assertCeloMainnet();
  const treasury = orchestratorAccount();
  const agent1 = agentAccount(1);
  const wallet = celoWalletClient(treasury);

  const usdtBal = await celoPublicClient.readContract({
    address: TOKENS.USDT,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [treasury.address],
  });
  console.log(`treasury ${treasury.address}: ${formatUnits(usdtBal, 6)} USDT`);

  const totalIn = parseUnits(String(SWAP_TOTAL_USDT), 6);
  if (usdtBal < totalIn) {
    throw new Error(
      `treasury holds ${formatUnits(usdtBal, 6)} USDT < planned ${SWAP_TOTAL_USDT}`,
    );
  }

  const trancheIn = parseUnits(String(TRANCHE_USDT), 6);
  const tranches = SWAP_TOTAL_USDT / TRANCHE_USDT;
  const perTrancheOut = await quoteSwap(TOKENS.USDT, TOKENS.USDm, trancheIn);
  console.log(
    `plan: ${tranches} x ${TRANCHE_USDT} USDT -> cUSD (quote per tranche: ` +
      `${formatUnits(perTrancheOut, 18)} USDm), gas in USDT via fee adapter; ` +
      `then send ${AGENT1_SEED_CUSD} cUSD to agent-1 ${agent1.address}, gas in cUSD.`,
  );

  if (!LIVE) {
    console.log("\nDRY-RUN. Set ALLOW_LIVE_TREASURY=true to broadcast.");
    return;
  }

  // --- one exact-amount approval for the full total -------------------------
  const mento = await getMento();
  const probe = await mento.swap.buildSwapTransaction(
    TOKENS.USDT,
    TOKENS.USDm,
    trancheIn,
    treasury.address,
    treasury.address,
    { slippageTolerance: 1, deadline: BigInt(Math.floor(Date.now() / 1000) + 300) },
  );
  if (probe.approval) {
    // approve(spender, amount) calldata: 4-byte selector + 32-byte spender + 32-byte amount
    const spender = ("0x" + (probe.approval.data as string).slice(34, 74)) as Address;
    assertTxAllowed(0, "treasury USDT approval (moves no funds)");
    const approveHash = await wallet.writeContract({
      address: TOKENS.USDT,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, totalIn],
      feeCurrency: FEE_CURRENCIES.USDT_ADAPTER,
    });
    const rcpt = await celoPublicClient.waitForTransactionReceipt({ hash: approveHash });
    if (rcpt.status !== "success") throw new Error(`approve reverted ${approveHash}`);
    logActivity({
      agentId: "orchestrator",
      action: "treasury-approve",
      rationale: `One-time exact-amount approval of ${SWAP_TOTAL_USDT} USDT to Mento router ${spender} so the ${tranches} treasury conversion tranches don't each need their own approval tx.`,
      txHash: approveHash,
      spender,
    });
    console.log(`approved ${SWAP_TOTAL_USDT} USDT to ${spender}: ${explorerTx(approveHash)}`);
  } else {
    console.log("allowance already sufficient, skipping approval");
  }

  // --- tranche swaps ---------------------------------------------------------
  let totalOut = 0n;
  for (let i = 1; i <= tranches; i++) {
    const res = await executeSwap({
      account: treasury,
      agentId: "orchestrator",
      tokenIn: TOKENS.USDT,
      tokenOut: TOKENS.USDm,
      amountIn: trancheIn,
      tokenInDecimals: 6,
      tokenOutDecimals: 18,
      usdValue: TRANCHE_USDT,
      feeCurrency: FEE_CURRENCIES.USDT_ADAPTER,
      rationale:
        `Treasury setup tranche ${i}/${tranches}: convert ${TRANCHE_USDT} USDT to cUSD(USDm), ` +
        `the swarm base currency, via Mento. Tranche-sized to respect the $${MAX_TX_USD} ` +
        `per-tx cap. Gas paid in USDT via CIP-64 fee adapter (wallet holds no CELO).`,
    });
    totalOut += res.amountOut;
    console.log(
      `tranche ${i}/${tranches}: ${explorerTx(res.swapTxHash)} (~${formatUnits(res.amountOut, 18)} USDm)`,
    );
  }
  console.log(`swapped ${SWAP_TOTAL_USDT} USDT -> ~${formatUnits(totalOut, 18)} USDm`);

  // --- seed agent-1 for the Phase 1 smoke test -------------------------------
  assertTxAllowed(AGENT1_SEED_CUSD, "agent-1 seed transfer");
  const seedHash = await wallet.writeContract({
    address: TOKENS.USDm,
    abi: erc20Abi,
    functionName: "transfer",
    args: [agent1.address, parseUnits(String(AGENT1_SEED_CUSD), 18)],
    feeCurrency: FEE_CURRENCIES.USDm,
  });
  const seedRcpt = await celoPublicClient.waitForTransactionReceipt({ hash: seedHash });
  if (seedRcpt.status !== "success") throw new Error(`seed transfer reverted ${seedHash}`);
  logActivity({
    agentId: "orchestrator",
    action: "agent-seed",
    rationale: `Seed agent-1 with ${AGENT1_SEED_CUSD} cUSD for the Phase 1 fee-abstraction smoke test. Gas paid in cUSD.`,
    txHash: seedHash,
    recipient: agent1.address,
  });
  console.log(`seeded agent-1: ${explorerTx(seedHash)}`);

  const [usdtAfter, usdmAfter] = await Promise.all([
    celoPublicClient.readContract({ address: TOKENS.USDT, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address] }),
    celoPublicClient.readContract({ address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address] }),
  ]);
  console.log(
    `treasury final: ${formatUnits(usdtAfter, 6)} USDT, ${formatUnits(usdmAfter, 18)} USDm`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
