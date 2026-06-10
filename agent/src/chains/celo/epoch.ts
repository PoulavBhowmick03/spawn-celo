/**
 * Epoch engine (Phase 4): evaluate → cull → spawn → rebalance, per
 * CLAUDE.md §3.3 with the Phase 0-confirmed semantics (4h epochs, bottom-20%
 * cull, min swarm 5). One call to runEpochCycle():
 *
 *   1. SETTLE the previous epoch (if one is open): mark every agent's
 *      portfolio in cUSD, compute fitness from (vStart, vEnd, gas), post
 *      reputation feedback onchain, cull the bottom 20% (unwind to treasury
 *      + recallChild), spawn replacements from the top performer's mutated
 *      genome (new wallet, card, ERC-8004 identity, funding, spawnChild).
 *   2. START the next epoch: snapshot market, set vStart, evaluate every
 *      strategy, execute the intents, record decision proofs.
 *
 * Every onchain action flows through the budget rails and the activity log.
 */

import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { erc20Abi, formatUnits, parseEventLogs, parseUnits, type Address, type Hex } from "viem";
import { FEE_CURRENCIES, SPAWN, TOKENS, explorerTx } from "./addresses.js";
import { celoPublicClient, celoWalletClient, maybeFee } from "./chain.js";
import { deriveAccount, orchestratorAccount } from "./wallets.js";
import { snapshotMarket, type MarketContext } from "./market.js";
import { readPortfolio } from "./portfolio.js";
import { strategyFor } from "./strategies.js";
import { executeActions } from "./executor.js";
import { fitness, median, reputationScore, selectCulls } from "./fitness.js";
import { postEpochFeedback } from "./reputation.js";
import { unwindAgentToTreasury } from "./unwind.js";
import { registerIdentity } from "./identity.js";
import { cardUrl, writeAgentCard, saveRegistryEntry, PAGES_BASE } from "./generate-cards.js";
import { loadState, saveState, type SwarmAgentState, type SwarmState } from "./swarm-state.js";
import { logActivity } from "./activity-log.js";
import { MAX_AGENT_BALANCE_USD, assertTxAllowed, killSwitchEngaged } from "./budget.js";
import type { AgentSpec } from "./agents-config.js";

const SPAWN_FACTORY_ABI = [
  {
    name: "spawnChild",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lineageKey", type: "string" },
      { name: "generation", type: "uint256" },
      { name: "childWallet", type: "address" },
    ],
    outputs: [
      { name: "child", type: "address" },
      { name: "agentId", type: "uint256" },
    ],
  },
  {
    name: "ChildSpawned",
    type: "event",
    inputs: [
      { name: "child", type: "address", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "lineageKey", type: "string", indexed: false },
      { name: "generation", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
] as const;

const CHILD_RECALL_ABI = [
  {
    name: "recallChild",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reason", type: "string" },
      { name: "ipfsCid", type: "string" },
    ],
    outputs: [],
  },
] as const;

const EPOCH_HOURS = Number(process.env.EPOCH_HOURS ?? 4);
const REPO_ROOT = resolve(process.cwd(), "..");

/** Commit + push docs/, activity log and swarm state so cards/reports resolve publicly. */
export function publishDocs(message: string): void {
  if (/^(1|true|yes)$/i.test(process.env.CELO_NO_PUBLISH ?? "")) return; // fork tests
  try {
    execSync(
      `git add docs celo_activity.jsonl celo_swarm_state.json && ` +
        `git -c user.name="spawn-orchestrator" -c user.email="orchestrator@spawn.local" commit -m ${JSON.stringify(message)} && ` +
        `git push spawn-celo HEAD:main`,
      { cwd: REPO_ROOT, stdio: "pipe" },
    );
  } catch (e: unknown) {
    const msg = String((e as { stderr?: Buffer }).stderr ?? e);
    if (msg.includes("nothing to commit")) return;
    console.warn(`publishDocs failed (continuing, will retry next epoch): ${msg.slice(0, 200)}`);
  }
}

async function waitForCard(url: string, timeoutMs = 360_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* pages still building */
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error(`agent card never resolved: ${url}`);
}

/** Call SpawnFactory.spawnChild for onchain spawn provenance; returns clone address. */
export async function spawnChildOnchain(
  lineageKey: string,
  generation: number,
  childWallet: Address,
  slug: string,
): Promise<{ childContract: Address; txHash: Hex }> {
  const orch = orchestratorAccount();
  const wallet = celoWalletClient(orch);
  assertTxAllowed(0, `spawnChild ${slug} (moves no funds)`);
  const txHash = await wallet.writeContract({
    address: SPAWN.SPAWN_FACTORY,
    abi: SPAWN_FACTORY_ABI,
    functionName: "spawnChild",
    args: [lineageKey, BigInt(generation), childWallet],
    feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
  });
  const receipt = await celoPublicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`spawnChild reverted: ${explorerTx(txHash)}`);
  const ev = parseEventLogs({ abi: SPAWN_FACTORY_ABI, eventName: "ChildSpawned", logs: receipt.logs })[0];
  logActivity({
    agentId: "orchestrator",
    action: "spawn-child-onchain",
    rationale: `Onchain spawn provenance for ${slug}: SpawnFactory cloned a ChildAgent (lineage "${lineageKey}", generation ${generation}, wallet ${childWallet}); decision proofs for this agent will be recorded on the clone.`,
    txHash,
    childContract: ev.args.child,
  });
  return { childContract: ev.args.child, txHash };
}

/** ±20% multiplicative jitter on the numeric genome (booleans inherited as-is). */
export function mutateParams(
  params: Record<string, number | boolean>,
): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number") {
      const jitter = 0.8 + Math.random() * 0.4;
      out[k] = Math.max(1, Math.round(v * jitter));
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function usdmBalance(addr: Address): Promise<bigint> {
  return celoPublicClient.readContract({
    address: TOKENS.USDm,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [addr],
  });
}

/** Spawn one replacement agent inheriting (mutated) genome from `parent`. */
async function spawnReplacement(
  state: SwarmState,
  parent: SwarmAgentState,
  spawnPoolUsd: number,
): Promise<SwarmAgentState | undefined> {
  const hdIndex = state.nextHdIndex++;
  const generation = parent.generation + 1;
  const slug = `${parent.lineageKey}-g${generation}-i${hdIndex}`;
  const account = deriveAccount(hdIndex);
  const params = mutateParams(parent.params);

  const spec = {
    hdIndex,
    slug,
    name: `${parent.name} g${generation}`,
    strategy: parent.strategy,
    params,
    description: `Generation ${generation} of the "${parent.lineageKey}" lineage, spawned from epoch-${state.epochNumber} top performer ${parent.slug} with ±20% mutated parameters. ${strategyFor(parent as unknown as AgentSpec).describe(params)}`,
    useSignal: parent.useSignal,
  } as AgentSpec;

  // card must resolve before registration (CLAUDE.md §8)
  writeAgentCard(spec);
  publishDocs(`feat(swarm): agent card for spawned ${slug} (epoch ${state.epochNumber})`);
  await waitForCard(cardUrl(slug));

  const { agentId, txHash: regTx } = await registerIdentity(account, slug, cardUrl(slug));
  saveRegistryEntry(slug, { agentId: agentId.toString(), address: account.address, txHash: regTx });
  writeAgentCard(spec); // re-write with registrations[] embedded

  // fund from the spawn pool (culled agents' returned balances), capped per agent
  const fundUsd = Math.min(MAX_AGENT_BALANCE_USD, spawnPoolUsd);
  if (fundUsd < 1) {
    console.warn(`spawn pool too small ($${fundUsd.toFixed(2)}) — ${slug} registered but unfunded this epoch`);
  } else {
    assertTxAllowed(fundUsd, `fund spawned agent ${slug}`);
    const orchWallet = celoWalletClient(orchestratorAccount());
    const hash = await orchWallet.writeContract({
      address: TOKENS.USDm,
      abi: erc20Abi,
      functionName: "transfer",
      args: [account.address, parseUnits(fundUsd.toFixed(6), 18)],
      feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
    });
    await celoPublicClient.waitForTransactionReceipt({ hash });
    logActivity({
      agentId: "orchestrator",
      action: "spawn-funding",
      rationale: `Fund spawned agent ${slug} with $${fundUsd.toFixed(2)} cUSD from the spawn pool (recycled from culled agents' returned balances; per-agent cap $${MAX_AGENT_BALANCE_USD}).`,
      txHash: hash,
      recipient: account.address,
    });
  }

  const { childContract, txHash: spawnTx } = await spawnChildOnchain(
    parent.lineageKey,
    generation,
    account.address,
    slug,
  );

  return {
    slug,
    name: spec.name,
    hdIndex,
    address: account.address,
    erc8004AgentId: agentId.toString(),
    strategy: parent.strategy,
    params,
    useSignal: parent.useSignal,
    generation,
    lineageKey: parent.lineageKey,
    status: "ACTIVE",
    childContract,
    spawnTxHash: spawnTx,
    history: [],
  };
}

export type EpochReport = {
  epoch: number;
  settledAt: string;
  epochHours: number;
  market: MarketContext;
  agents: Array<{
    slug: string;
    erc8004AgentId: string;
    strategy: string;
    generation: number;
    vStartUsd: number;
    vEndUsd: number;
    gasUsd: number;
    fitness: number;
    score: number;
    culled: boolean;
    reputationTx?: Hex;
  }>;
  swarmMedianFitness: number;
  culled: string[];
  spawned: string[];
};

/** Settle the open epoch: fitness, reputation, cull, spawn. Returns the report. */
export async function settleEpoch(state: SwarmState, ctx: MarketContext): Promise<EpochReport | undefined> {
  const active = state.agents.filter((a) => a.status === "ACTIVE" && a.vStartUsd !== undefined);
  if (active.length === 0) return undefined;
  const orch = orchestratorAccount();

  // 1. mark every portfolio and compute fitness
  const rows: Array<{ agent: SwarmAgentState; vEndUsd: number; gasUsd: number; fitness: number }> = [];
  for (const agent of active) {
    const pf = await readPortfolio(agent.address, ctx);
    const gasUsd = (agent as SwarmAgentState & { epochGasUsd?: number }).epochGasUsd ?? 0;
    const f = fitness({
      vStartUsd: agent.vStartUsd!,
      vEndUsd: pf.totalUsd,
      gasUsd,
      epochHours: EPOCH_HOURS,
    });
    rows.push({ agent, vEndUsd: pf.totalUsd, gasUsd, fitness: f });
  }
  const swarmMedian = median(rows.map((r) => r.fitness));

  // 2. reputation feedback for every agent (performance attestation)
  const reportRows: EpochReport["agents"] = [];
  const reportUrl = `${PAGES_BASE}/epochs/epoch-${state.epochNumber}.json`;
  for (const r of rows) {
    const score = reputationScore(r.fitness, swarmMedian);
    const reputationTx = await postEpochFeedback(orch, {
      agentId: BigInt(r.agent.erc8004AgentId),
      agentSlug: r.agent.slug,
      score,
      strategy: r.agent.strategy,
      epochNumber: state.epochNumber,
      fitnessInputs: {
        vStartUsd: r.agent.vStartUsd!,
        vEndUsd: r.vEndUsd,
        gasUsd: r.gasUsd,
        epochHours: EPOCH_HOURS,
      },
      feedbackURI: reportUrl,
    }, !process.env.CELO_NATIVE_GAS);
    r.agent.history.push({
      epoch: state.epochNumber,
      fitness: r.fitness,
      score,
      vEndUsd: r.vEndUsd,
      gasUsd: r.gasUsd,
    });
    reportRows.push({
      slug: r.agent.slug,
      erc8004AgentId: r.agent.erc8004AgentId,
      strategy: r.agent.strategy,
      generation: r.agent.generation,
      vStartUsd: r.agent.vStartUsd!,
      vEndUsd: r.vEndUsd,
      gasUsd: r.gasUsd,
      fitness: r.fitness,
      score,
      culled: false,
      reputationTx,
    });
    saveState(state);
  }

  // 3. cull bottom 20% (min swarm 5): unwind to treasury + recallChild
  const culls = selectCulls(rows.map((r) => ({ ...r, fitness: r.fitness })));
  const culledSlugs: string[] = [];
  let spawnPoolUsd = 0;
  for (const c of culls) {
    const agent = c.agent;
    const account = deriveAccount(agent.hdIndex);
    const reason = `epoch ${state.epochNumber} cull: fitness ${c.fitness.toFixed(3)} in bottom 20% (median ${swarmMedian.toFixed(3)})`;
    const unwound = await unwindAgentToTreasury(account, agent.slug, orch.address, reason, !process.env.CELO_NATIVE_GAS);
    spawnPoolUsd += Number(formatUnits(unwound.sweptUsdm, 18));

    if (agent.childContract) {
      const orchWallet = celoWalletClient(orch);
      const recallTx = await orchWallet.writeContract({
        address: agent.childContract,
        abi: CHILD_RECALL_ABI,
        functionName: "recallChild",
        args: [reason, reportUrl],
        feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
      });
      await celoPublicClient.waitForTransactionReceipt({ hash: recallTx });
      agent.recallTxHash = recallTx;
      logActivity({
        agentId: agent.slug,
        action: "recall-onchain",
        rationale: `Onchain recall of culled agent ${agent.slug}: ${reason}. Post-mortem: ${reportUrl}. Funds returned to treasury; ERC-8004 identity #${agent.erc8004AgentId} retired with its honest final reputation intact.`,
        txHash: recallTx,
      });
    }
    agent.status = "RETIRED";
    culledSlugs.push(agent.slug);
    const row = reportRows.find((x) => x.slug === agent.slug);
    if (row) row.culled = true;
    saveState(state);
  }

  // 4. spawn replacements from the top performer's mutated genome
  const spawnedSlugs: string[] = [];
  if (culls.length > 0 && /^(1|true|yes)$/i.test(process.env.CELO_SKIP_SPAWN ?? "")) {
    console.log(`  CELO_SKIP_SPAWN set — skipping ${culls.length} replacement spawn(s) (fork test)`);
  } else if (culls.length > 0) {
    const top = rows.reduce((a, b) => (a.fitness >= b.fitness ? a : b)).agent;
    for (let i = 0; i < culls.length; i++) {
      const child = await spawnReplacement(state, top, spawnPoolUsd / culls.length);
      if (child) {
        state.agents.push(child);
        spawnedSlugs.push(child.slug);
        saveState(state);
      }
    }
  }

  const report: EpochReport = {
    epoch: state.epochNumber,
    settledAt: new Date().toISOString(),
    epochHours: EPOCH_HOURS,
    market: ctx,
    agents: reportRows,
    swarmMedianFitness: swarmMedian,
    culled: culledSlugs,
    spawned: spawnedSlugs,
  };
  const epochsDir = resolve(REPO_ROOT, "docs", "epochs");
  mkdirSync(epochsDir, { recursive: true });
  writeFileSync(resolve(epochsDir, `epoch-${state.epochNumber}.json`), JSON.stringify(report, null, 2) + "\n");
  return report;
}

/** Start a new epoch: snapshot market, set vStart, evaluate + execute strategies. */
export async function startEpoch(state: SwarmState): Promise<MarketContext> {
  const ctx = await snapshotMarket(state.prevFxUsdPrice ? { fxUsdPrice: state.prevFxUsdPrice } : undefined);
  const orch = orchestratorAccount();

  for (const agent of state.agents) {
    if (agent.status !== "ACTIVE") continue;
    if (killSwitchEngaged()) throw new Error("kill switch engaged mid-epoch start");
    const account = deriveAccount(agent.hdIndex);
    const pf = await readPortfolio(agent.address, ctx);
    agent.vStartUsd = pf.totalUsd;
    (agent as SwarmAgentState & { epochGasUsd?: number }).epochGasUsd = 0;

    const actions = strategyFor(agent as unknown as AgentSpec).evaluate(ctx, pf, agent.params);
    const result = await executeActions(agent, account, orch, actions, state.epochNumber);
    (agent as SwarmAgentState & { epochGasUsd?: number }).epochGasUsd = result.gasUsd;
    console.log(
      `  ${agent.slug}: V_start $${pf.totalUsd.toFixed(3)}, ${result.executed} action(s) executed, ${result.held} hold, gas $${result.gasUsd.toFixed(4)}`,
    );
    saveState(state);
  }

  state.prevFxUsdPrice = ctx.fxUsdPrice;
  state.epochStartedAt = new Date().toISOString();
  saveState(state);
  return ctx;
}

/** One full cycle: settle the open epoch (if any), then start the next. */
export async function runEpochCycle(): Promise<void> {
  const state = loadState();
  if (!state) throw new Error("no swarm state — run swarm-start first");

  const ctx = await snapshotMarket(state.prevFxUsdPrice ? { fxUsdPrice: state.prevFxUsdPrice } : undefined);
  const report = await settleEpoch(state, ctx);
  if (report) {
    console.log(
      `epoch ${report.epoch} settled: median fitness ${report.swarmMedianFitness.toFixed(3)}, culled [${report.culled}], spawned [${report.spawned}]`,
    );
    state.epochNumber++;
  }
  await startEpoch(state);
  publishDocs(`chore(swarm): epoch ${state.epochNumber} state + report`);
  console.log(`epoch ${state.epochNumber} started at ${state.epochStartedAt}`);
}
