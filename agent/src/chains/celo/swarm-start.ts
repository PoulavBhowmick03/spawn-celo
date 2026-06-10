/**
 * Swarm launcher (Phase 4).
 *
 *   npm run swarm:start             # init (if needed) + run epochs forever
 *   npm run swarm:start -- --once   # init + exactly one epoch cycle, then exit
 *
 * Init (first run only): builds swarm state from the registered roster,
 * funds every agent to $5 cUSD from the treasury, and emits one
 * SpawnFactory.spawnChild per agent for onchain generation-1 provenance.
 *
 * Kill switch: SIGINT/SIGTERM or KILL_SWITCH=true unwinds every active
 * agent's portfolio back to the treasury and stops. Live mainnet writes are
 * gated behind ALLOW_LIVE_SWARM=true.
 */

import "./env.js";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { FEE_CURRENCIES, TOKENS } from "./addresses.js";
import { assertCeloMainnet, celoPublicClient, celoWalletClient, maybeFee } from "./chain.js";
import { deriveAccount, orchestratorAccount } from "./wallets.js";
import { SWARM_AGENTS } from "./agents-config.js";
import { loadRegistry } from "./generate-cards.js";
import { loadState, saveState, statePath, type SwarmState } from "./swarm-state.js";
import { runEpochCycle, publishDocs, spawnChildOnchain } from "./epoch.js";
import { unwindAgentToTreasury } from "./unwind.js";
import { MAX_AGENT_BALANCE_USD, assertTxAllowed, killSwitchEngaged } from "./budget.js";
import { logActivity } from "./activity-log.js";

const LIVE = /^(1|true|yes)$/i.test(process.env.ALLOW_LIVE_SWARM ?? "");
const ONCE = process.argv.includes("--once");
const EPOCH_HOURS = Number(process.env.EPOCH_HOURS ?? 4);

async function initState(): Promise<SwarmState> {
  const registry = loadRegistry();
  const state: SwarmState = {
    epochNumber: 1,
    nextHdIndex: Math.max(...SWARM_AGENTS.map((a) => a.hdIndex)) + 1,
    agents: SWARM_AGENTS.map((spec) => {
      const reg = registry[spec.slug];
      if (!reg) throw new Error(`${spec.slug} missing from registry.json — run register:agents first`);
      return {
        slug: spec.slug,
        name: spec.name,
        hdIndex: spec.hdIndex,
        address: deriveAccount(spec.hdIndex).address,
        erc8004AgentId: reg.agentId,
        strategy: spec.strategy,
        params: { ...spec.params },
        useSignal: spec.useSignal,
        generation: 1,
        lineageKey: spec.slug,
        status: "ACTIVE" as const,
        history: [],
      };
    }),
  };
  saveState(state);
  return state;
}

async function fundAgents(state: SwarmState): Promise<void> {
  const treasury = orchestratorAccount();
  const wallet = celoWalletClient(treasury);
  // fund against FULL portfolio value (wallet + Aave + FX legs), not wallet
  // cUSD — a deployed agent's wallet looks empty, and re-funding it would
  // both break the per-agent cap and drain the treasury on every restart.
  const { snapshotMarket } = await import("./market.js");
  const { readPortfolio } = await import("./portfolio.js");
  const ctx = await snapshotMarket(state.prevFxUsdPrice ? { fxUsdPrice: state.prevFxUsdPrice } : undefined);
  for (const agent of state.agents) {
    if (agent.status !== "ACTIVE") continue;
    const pf = await readPortfolio(agent.address, ctx);
    const topUp = MAX_AGENT_BALANCE_USD - pf.totalUsd;
    if (topUp < 0.1) {
      console.log(`  ${agent.slug}: already funded (portfolio $${pf.totalUsd.toFixed(2)})`);
      continue;
    }
    const treasuryBal = Number(
      formatUnits(
        await celoPublicClient.readContract({
          address: TOKENS.USDm,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [treasury.address],
        }),
        18,
      ),
    );
    if (treasuryBal < topUp) {
      console.warn(`  ${agent.slug}: treasury ($${treasuryBal.toFixed(2)}) can't cover +$${topUp.toFixed(2)} — skipping`);
      continue;
    }
    assertTxAllowed(topUp, `fund ${agent.slug}`);
    const hash = await wallet.writeContract({
      address: TOKENS.USDm,
      abi: erc20Abi,
      functionName: "transfer",
      args: [agent.address, parseUnits(topUp.toFixed(6), 18)],
      feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
    });
    await celoPublicClient.waitForTransactionReceipt({ hash });
    logActivity({
      agentId: "orchestrator",
      action: "agent-funding",
      rationale: `Fund ${agent.slug} to the $${MAX_AGENT_BALANCE_USD} per-agent cap (+$${topUp.toFixed(2)} cUSD) so its ${agent.strategy} strategy can trade. Total swarm deployment stays within the $50 budget.`,
      txHash: hash,
      recipient: agent.address,
    });
    console.log(`  ${agent.slug}: funded +$${topUp.toFixed(2)}`);
  }
}

async function ensureChildContracts(state: SwarmState): Promise<void> {
  for (const agent of state.agents) {
    if (agent.status !== "ACTIVE" || agent.childContract) continue;
    const { childContract, txHash } = await spawnChildOnchain(
      agent.lineageKey,
      agent.generation,
      agent.address,
      agent.slug,
    );
    agent.childContract = childContract;
    agent.spawnTxHash = txHash;
    saveState(state);
    console.log(`  ${agent.slug}: ChildAgent clone ${childContract}`);
  }
}

async function unwindAll(state: SwarmState, reason: string): Promise<void> {
  console.log(`\nKILL SWITCH: unwinding all active agents (${reason})`);
  const treasury = orchestratorAccount();
  for (const agent of state.agents) {
    if (agent.status !== "ACTIVE") continue;
    try {
      const res = await unwindAgentToTreasury(
        deriveAccount(agent.hdIndex),
        agent.slug,
        treasury.address,
        `kill switch: ${reason}`,
        !process.env.CELO_NATIVE_GAS,
      );
      console.log(`  ${agent.slug}: swept ${formatUnits(res.sweptUsdm, 18)} cUSD home`);
    } catch (e) {
      console.error(`  ${agent.slug}: unwind FAILED — ${(e as Error).message}`);
    }
  }
  saveState(state);
  publishDocs("chore(swarm): kill-switch unwind state");
}

async function main() {
  await assertCeloMainnet();
  if (!LIVE) {
    console.log("DRY-RUN (set ALLOW_LIVE_SWARM=true to trade). Printing what init would do:");
    const state = loadState() ?? (await initState());
    console.log(`state: ${statePath()}, epoch ${state.epochNumber}, agents ${state.agents.length}`);
    return;
  }

  let state = loadState();
  if (!state) {
    console.log("initializing swarm state…");
    state = await initState();
  }

  let stopping = false;
  const stop = async (reason: string) => {
    if (stopping) return;
    stopping = true;
    await unwindAll(loadState() ?? state!, reason);
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));

  console.log("funding agents…");
  await fundAgents(state);
  console.log("ensuring onchain ChildAgent provenance…");
  await ensureChildContracts(state);

  for (;;) {
    if (killSwitchEngaged()) return void (await stop("KILL_SWITCH env flag"));
    await runEpochCycle();
    if (ONCE) {
      console.log("--once: epoch cycle complete, exiting (swarm stays deployed)");
      return;
    }
    console.log(`sleeping ${EPOCH_HOURS}h until next epoch…`);
    await new Promise((r) => setTimeout(r, EPOCH_HOURS * 3600 * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
