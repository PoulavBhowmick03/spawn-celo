/**
 * Phase 6 setup (one-time):
 *   1. register the signal oracle (HD index 30) as an ERC-8004 identity with
 *      an x402Support card
 *   2. fund it with cUSD for settlement gas
 *   3. give each useSignal agent a small USDC balance to pay for signals
 *      (treasury swaps cUSD -> USDC once, then distributes)
 *
 *   ALLOW_LIVE_X402_SETUP=true npm run x402:setup
 */

import "./env.js";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { FEE_CURRENCIES, TOKENS, explorerTx } from "./addresses.js";
import { assertCeloMainnet, celoPublicClient, celoWalletClient, maybeFee } from "./chain.js";
import { deriveAccount, orchestratorAccount } from "./wallets.js";
import { SWARM_AGENTS } from "./agents-config.js";
import { registerIdentity } from "./identity.js";
import { cardUrl, loadRegistry, saveRegistryEntry, writeAgentCard } from "./generate-cards.js";
import { executeSwap } from "./mento.js";
import { assertTxAllowed } from "./budget.js";
import { logActivity } from "./activity-log.js";
import { publishDocs } from "./epoch.js";
import { SIGNAL_AGENT_HD_INDEX } from "./signal-service.js";
import { loadState } from "./swarm-state.js";

const LIVE = /^(1|true|yes)$/i.test(process.env.ALLOW_LIVE_X402_SETUP ?? "");
const USDC_PER_BUYER = parseUnits("0.6", 6); // ~300 signal calls each
const ORACLE_GAS_CUSD = parseUnits("0.3", 18);

const ORACLE_SPEC = {
  hdIndex: SIGNAL_AGENT_HD_INDEX,
  slug: "signal-oracle",
  name: "Spawn Signal Oracle",
  description:
    "x402 service agent of the Spawn Hedge Swarm: sells a market-signal endpoint (5-minute-resolution Mento FX momentum + live Aave v3 APYs) for $0.002 USDC per call, settled onchain via EIP-3009 transferWithAuthorization (x402 exact scheme). Buyers are the swarm's own useSignal agents — real agent-to-agent commerce, every sale a USDC transfer on Celoscan.",
  x402Support: true,
} as const;

async function main() {
  await assertCeloMainnet();
  const treasury = orchestratorAccount();
  const treasuryWallet = celoWalletClient(treasury);
  const oracle = deriveAccount(SIGNAL_AGENT_HD_INDEX);

  // signal buyers: live swarm agents (incl. spawned) with useSignal=true
  const state = loadState();
  const buyers = (state?.agents ?? [])
    .filter((a) => a.status === "ACTIVE" && a.useSignal)
    .map((a) => ({ slug: a.slug, address: a.address }));
  if (buyers.length === 0) {
    // fall back to the static roster if state is unavailable
    for (const s of SWARM_AGENTS.filter((s) => s.useSignal)) {
      buyers.push({ slug: s.slug, address: deriveAccount(s.hdIndex).address });
    }
  }
  console.log(`oracle: ${oracle.address} | buyers: ${buyers.map((b) => b.slug).join(", ")}`);

  if (!LIVE) {
    console.log("DRY-RUN. Set ALLOW_LIVE_X402_SETUP=true to execute.");
    return;
  }

  // 1. gas for the oracle (it submits settlement txs, gas in cUSD)
  const oracleBal = await celoPublicClient.readContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [oracle.address],
  });
  if (oracleBal < ORACLE_GAS_CUSD / 2n) {
    assertTxAllowed(0.3, "signal oracle gas funding");
    const hash = await treasuryWallet.writeContract({
      address: TOKENS.USDm, abi: erc20Abi, functionName: "transfer",
      args: [oracle.address, ORACLE_GAS_CUSD],
      feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
      ...(maybeFee(FEE_CURRENCIES.USDm) ? { gas: 120_000n } : {}),
    });
    await celoPublicClient.waitForTransactionReceipt({ hash });
    logActivity({
      agentId: "orchestrator",
      action: "oracle-gas-funding",
      rationale: "Fund the signal oracle with 0.3 cUSD so it can pay CIP-64 gas when settling x402 USDC payments onchain.",
      txHash: hash,
    });
    console.log(`oracle gas funded: ${explorerTx(hash)}`);
  }

  // 2. ERC-8004 identity for the oracle (self-owned, card must resolve first)
  const registry = loadRegistry();
  if (!registry["signal-oracle"]) {
    writeAgentCard(ORACLE_SPEC as never);
    publishDocs("feat(x402): signal oracle agent card");
    const url = cardUrl("signal-oracle");
    for (let i = 0; i < 24; i++) {
      const r = await fetch(url).catch(() => null);
      if (r?.ok) break;
      await new Promise((res) => setTimeout(res, 15_000));
    }
    const { agentId, txHash } = await registerIdentity(oracle, "signal-oracle", url);
    saveRegistryEntry("signal-oracle", { agentId: agentId.toString(), address: oracle.address, txHash });
    writeAgentCard(ORACLE_SPEC as never); // embed registrations[]
    console.log(`signal-oracle registered as ERC-8004 #${agentId}`);
  } else {
    console.log(`signal-oracle already registered as #${registry["signal-oracle"].agentId}`);
  }

  // 3. USDC for the buyers: one treasury swap, then distribute
  const totalUsdcNeeded = USDC_PER_BUYER * BigInt(buyers.length);
  const treasuryUsdc = await celoPublicClient.readContract({
    address: TOKENS.USDC, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address],
  });
  if (treasuryUsdc < totalUsdcNeeded) {
    const buyUsd = Number(formatUnits(totalUsdcNeeded - treasuryUsdc, 6)) + 0.1;
    await executeSwap({
      account: treasury,
      agentId: "orchestrator",
      tokenIn: TOKENS.USDm,
      tokenOut: TOKENS.USDC,
      amountIn: parseUnits(buyUsd.toFixed(6), 18),
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      usdValue: buyUsd,
      feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
      rationale: `Convert $${buyUsd.toFixed(2)} cUSD to USDC so useSignal agents can pay the x402 signal oracle (EIP-3009 requires USDC).`,
    });
  }
  for (const b of buyers) {
    const bal = await celoPublicClient.readContract({
      address: TOKENS.USDC, abi: erc20Abi, functionName: "balanceOf", args: [b.address],
    });
    if (bal >= USDC_PER_BUYER / 2n) {
      console.log(`${b.slug}: already has ${formatUnits(bal, 6)} USDC`);
      continue;
    }
    assertTxAllowed(0.6, `USDC signal budget for ${b.slug}`);
    const hash = await treasuryWallet.writeContract({
      address: TOKENS.USDC, abi: erc20Abi, functionName: "transfer",
      args: [b.address, USDC_PER_BUYER],
      feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
      ...(maybeFee(FEE_CURRENCIES.USDm) ? { gas: 120_000n } : {}),
    });
    await celoPublicClient.waitForTransactionReceipt({ hash });
    logActivity({
      agentId: "orchestrator",
      action: "signal-budget-funding",
      rationale: `Fund ${b.slug} with ${formatUnits(USDC_PER_BUYER, 6)} USDC as its x402 signal budget (~300 calls at $0.002). The agent's strategy declared useSignal=true in its genome.`,
      txHash: hash,
      recipient: b.address,
    });
    console.log(`${b.slug}: funded ${formatUnits(USDC_PER_BUYER, 6)} USDC (${explorerTx(hash)})`);
  }

  publishDocs("feat(x402): signal oracle registered + buyers funded");
  console.log("x402 setup complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
