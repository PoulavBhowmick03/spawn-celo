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
import { MAX_AGENT_BALANCE_USD, TOTAL_BUDGET_USD, assertTxAllowed, killSwitchEngaged } from "./budget.js";
import { MAX_SWARM_SIZE, OPS_FLOAT_USD, shouldGrowSwarm } from "./growth.js";
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

/** Retired wallets can retain residuals when a sweep leg failed (e.g. fee
 *  balance too small at cull time). Re-run their unwind each cycle until the
 *  treasury has everything back. */
export async function sweepRetiredResiduals(state: SwarmState): Promise<void> {
  const orch = orchestratorAccount();
  for (const agent of state.agents) {
    if (agent.status !== "RETIRED") continue;
    try {
      const totals: bigint[] = await Promise.all([
        usdmBalance(agent.address),
        celoPublicClient.readContract({ address: TOKENS.USDC, abi: erc20Abi, functionName: "balanceOf", args: [agent.address] }),
        celoPublicClient.readContract({ address: TOKENS.USDT, abi: erc20Abi, functionName: "balanceOf", args: [agent.address] }),
        celoPublicClient.readContract({ address: TOKENS.EURm, abi: erc20Abi, functionName: "balanceOf", args: [agent.address] }),
        celoPublicClient.readContract({ address: TOKENS.BRLm, abi: erc20Abi, functionName: "balanceOf", args: [agent.address] }),
      ]);
      const roughUsd =
        Number(formatUnits(totals[0], 18)) +
        Number(formatUnits(totals[1], 6)) +
        Number(formatUnits(totals[2], 6)) +
        Number(formatUnits(totals[3], 18)) * 1.2 +
        Number(formatUnits(totals[4], 18)) * 0.2;
      if (roughUsd < 0.1) continue;
      console.log(`  residual sweep: ${agent.slug} retains ~$${roughUsd.toFixed(2)} — re-running unwind`);
      await unwindAgentToTreasury(
        deriveAccount(agent.hdIndex),
        agent.slug,
        orch.address,
        `residual sweep after retirement (prior sweep leg deferred)`,
        !process.env.CELO_NATIVE_GAS,
      );
    } catch (e) {
      console.warn(`  residual sweep ${agent.slug} failed (${(e as Error).message?.slice(0, 100)}) — will retry next cycle`);
    }
  }
}

/** Enqueue a spawn (persisted; completed/retried by processPendingSpawns).
 *  `spawnReason` distinguishes a cull replacement from a swarm-growth spawn in
 *  the judge-facing agent card description. */
function enqueueSpawn(
  state: SwarmState,
  parent: SwarmAgentState,
  fundUsd: number,
  spawnReason: "cull-replacement" | "growth" = "cull-replacement",
): void {
  const hdIndex = state.nextHdIndex++;
  const generation = parent.generation + 1;
  const slug = `${parent.lineageKey}-g${generation}-i${hdIndex}`;
  const params = mutateParams(parent.params);
  state.pendingSpawns = state.pendingSpawns ?? [];
  // useSignal is a gene too: a 20% flip chance keeps the signal-buying trait
  // in the pool even when the current top performer doesn't carry it (buyers
  // pay $0.002/call out of their own P&L, so selection prices the trait)
  const useSignal = Math.random() < 0.2 ? !parent.useSignal : parent.useSignal;
  const why =
    spawnReason === "growth"
      ? `Swarm-growth spawn: an extra agent funded purely from treasury margin recycled out of culled agents' returned balances (no new outside capital), growing the swarm toward its ${MAX_SWARM_SIZE}-agent cap.`
      : `Cull replacement: spawned to replace an agent culled from the bottom 20% of epoch-${state.epochNumber} fitness.`;
  state.pendingSpawns.push({
    slug,
    name: `${parent.name} g${generation}`,
    hdIndex,
    strategy: parent.strategy,
    params,
    useSignal,
    generation,
    lineageKey: parent.lineageKey,
    fundUsd: Math.min(MAX_AGENT_BALANCE_USD, fundUsd),
    description: `${why} Generation ${generation} of the "${parent.lineageKey}" lineage, spawned from epoch-${state.epochNumber} top performer ${parent.slug} with ±20% mutated parameters. ${strategyFor(parent as unknown as AgentSpec).describe(params)}`,
  });
  saveState(state);
}

/** Complete one pending spawn: FUND FIRST (the new wallet must be able to pay
 *  its own registration gas in cUSD), then card -> register -> spawnChild. */
async function completeSpawn(
  state: SwarmState,
  pending: import("./swarm-state.js").PendingSpawn,
): Promise<SwarmAgentState> {
  const account = deriveAccount(pending.hdIndex);
  const spec = pending as unknown as AgentSpec;

  // 1. funding before registration — registration gas comes out of this.
  // Funding comes from the LIVE treasury balance (residual sweeps may have
  // replenished it since the spawn was enqueued), capped per agent.
  if ((await usdmBalance(account.address)) < parseUnits("0.05", 18)) {
    const treasuryBal = Number(formatUnits(await usdmBalance(orchestratorAccount().address), 18));
    // fund to the per-agent target, but NEVER drain the treasury below the
    // ops float — orchestrator gas and the x402 USDC pool both live there
    // (observed: epoch-9 replacements left $0.25, starving signal budgets)
    pending.fundUsd = Math.min(MAX_AGENT_BALANCE_USD, treasuryBal - OPS_FLOAT_USD);
    if (pending.fundUsd < 2) throw new Error(`spawn pool too small ($${Math.max(0, pending.fundUsd).toFixed(2)} above the $${OPS_FLOAT_USD.toFixed(2)} ops float) for ${pending.slug} — deferring until cull returns replenish the treasury`);
    assertTxAllowed(pending.fundUsd, `fund spawned agent ${pending.slug}`);
    const orchWallet = celoWalletClient(orchestratorAccount());
    const hash = await orchWallet.writeContract({
      address: TOKENS.USDm,
      abi: erc20Abi,
      functionName: "transfer",
      args: [account.address, parseUnits(pending.fundUsd.toFixed(6), 18)],
      feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
      // explicit gas skips eth_estimateGas's oversized CIP-64 fee pre-debit
      ...(maybeFee(FEE_CURRENCIES.USDm) ? { gas: 120_000n } : {}),
    });
    await celoPublicClient.waitForTransactionReceipt({ hash });
    logActivity({
      agentId: "orchestrator",
      action: "spawn-funding",
      rationale: `Fund spawned agent ${pending.slug} with $${pending.fundUsd.toFixed(2)} cUSD from the spawn pool (recycled from culled agents' returned balances; per-agent cap $${MAX_AGENT_BALANCE_USD}). Funded before registration so the new wallet pays its own registration gas in cUSD.`,
      txHash: hash,
      recipient: account.address,
    });
  }

  // 1b. signal-buying lineages also need a USDC budget for x402 calls
  if (pending.useSignal) {
    const usdcBal = await celoPublicClient.readContract({
      address: TOKENS.USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
    });
    const budget = 350_000n; // 0.35 USDC
    if (usdcBal < budget / 2n) await ensureTreasuryUsdc(budget);
    const treasuryUsdc = await celoPublicClient.readContract({
      address: TOKENS.USDC, abi: erc20Abi, functionName: "balanceOf", args: [orchestratorAccount().address],
    });
    if (usdcBal < budget / 2n && treasuryUsdc >= budget) {
      const orchWallet = celoWalletClient(orchestratorAccount());
      const hash = await orchWallet.writeContract({
        address: TOKENS.USDC, abi: erc20Abi, functionName: "transfer",
        args: [account.address, budget],
        feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
        ...(maybeFee(FEE_CURRENCIES.USDm) ? { gas: 120_000n } : {}),
      });
      await celoPublicClient.waitForTransactionReceipt({ hash });
      logActivity({
        agentId: "orchestrator",
        action: "signal-budget-funding",
        rationale: `Fund spawned agent ${pending.slug} with 0.35 USDC: its inherited genome has useSignal=true, so it buys x402 market signals before each evaluation.`,
        txHash: hash,
        recipient: account.address,
      });
    }
  }

  // 2. card must resolve before registration (CLAUDE.md §8)
  writeAgentCard(spec);
  publishDocs(`feat(swarm): agent card for spawned ${pending.slug} (epoch ${state.epochNumber})`);
  await waitForCard(cardUrl(pending.slug));

  // 3. self-registration in the canonical Identity Registry
  const { agentId, txHash: regTx } = await registerIdentity(account, pending.slug, cardUrl(pending.slug));
  saveRegistryEntry(pending.slug, { agentId: agentId.toString(), address: account.address, txHash: regTx });
  writeAgentCard(spec); // re-write with registrations[] embedded

  // 4. onchain spawn provenance
  const { childContract, txHash: spawnTx } = await spawnChildOnchain(
    pending.lineageKey,
    pending.generation,
    account.address,
    pending.slug,
  );

  return {
    slug: pending.slug,
    name: pending.name,
    hdIndex: pending.hdIndex,
    address: account.address,
    erc8004AgentId: agentId.toString(),
    strategy: pending.strategy,
    params: pending.params,
    useSignal: pending.useSignal,
    generation: pending.generation,
    lineageKey: pending.lineageKey,
    status: "ACTIVE",
    childContract,
    spawnTxHash: spawnTx,
    history: [],
  };
}

/** Try to complete every pending spawn; failures stay queued for next cycle. */
export async function processPendingSpawns(state: SwarmState): Promise<string[]> {
  const done: string[] = [];
  for (const pending of [...(state.pendingSpawns ?? [])]) {
    try {
      const agent = await completeSpawn(state, pending);
      state.agents.push(agent);
      state.pendingSpawns = (state.pendingSpawns ?? []).filter((p) => p.slug !== pending.slug);
      done.push(pending.slug);
      saveState(state);
      console.log(`  spawned ${pending.slug} (ERC-8004 #${agent.erc8004AgentId}, clone ${agent.childContract})`);
    } catch (e) {
      console.warn(`  spawn ${pending.slug} incomplete (${(e as Error).message?.slice(0, 120)}) — will retry next cycle`);
      saveState(state);
    }
  }
  return done;
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
    netFlowUsd?: number;
    /** per-row annualization hours — can differ from the report-level value
     *  when a crash-resumed settle reuses already-settled rows */
    epochHours?: number;
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

  // Annualize over the epoch's ACTUAL elapsed time (start/settle timestamps
  // are onchain-verifiable), not the configured cadence — restarts and
  // cadence changes must not distort the annualization. Floor of 15min
  // guards against absurd annualization on a near-instant settle.
  const epochHours = state.epochStartedAt
    ? Math.max(0.25, (Date.now() - Date.parse(state.epochStartedAt)) / 3600_000)
    : EPOCH_HOURS;

  // 1. mark every portfolio and compute fitness. Idempotent on re-runs after
  // a crash: an agent whose history already covers this epoch was settled and
  // had its feedback posted — reuse the stored numbers, don't recompute or
  // re-post.
  const rows: Array<{ agent: SwarmAgentState; vEndUsd: number; gasUsd: number; netFlowUsd: number; fitness: number; alreadySettled: boolean }> = [];
  for (const agent of active) {
    const prior = agent.history.find((h) => h.epoch === state.epochNumber);
    if (prior) {
      rows.push({ agent, vEndUsd: prior.vEndUsd, gasUsd: prior.gasUsd, netFlowUsd: prior.netFlowUsd ?? 0, fitness: prior.fitness, alreadySettled: true });
      continue;
    }
    const pf = await readPortfolio(agent.address, ctx);
    const gasUsd = agent.epochGasUsd ?? 0;
    const netFlowUsd = agent.epochFlowUsd ?? 0;
    const f = fitness({
      vStartUsd: agent.vStartUsd!,
      vEndUsd: pf.totalUsd,
      netFlowUsd,
      gasUsd,
      epochHours,
    });
    rows.push({ agent, vEndUsd: pf.totalUsd, gasUsd, netFlowUsd, fitness: f, alreadySettled: false });
  }
  const swarmMedian = median(rows.map((r) => r.fitness));

  // 2. reputation feedback for every agent (performance attestation)
  const reportRows: EpochReport["agents"] = [];
  const reportUrl = `${PAGES_BASE}/epochs/epoch-${state.epochNumber}.json`;
  for (const r of rows) {
    const score = reputationScore(r.fitness, swarmMedian);
    if (r.alreadySettled) {
      const prior = r.agent.history.find((h) => h.epoch === state.epochNumber)!;
      reportRows.push({
        slug: r.agent.slug,
        erc8004AgentId: r.agent.erc8004AgentId,
        strategy: r.agent.strategy,
        generation: r.agent.generation,
        vStartUsd: r.agent.vStartUsd!,
        vEndUsd: prior.vEndUsd,
        gasUsd: prior.gasUsd,
        netFlowUsd: prior.netFlowUsd ?? 0,
        epochHours: prior.epochHours ?? epochHours,
        fitness: prior.fitness,
        score: prior.score,
        culled: false,
      });
      continue;
    }
    const reputationTx = await postEpochFeedback(orch, {
      agentId: BigInt(r.agent.erc8004AgentId),
      agentSlug: r.agent.slug,
      score,
      strategy: r.agent.strategy,
      epochNumber: state.epochNumber,
      fitnessInputs: {
        vStartUsd: r.agent.vStartUsd!,
        vEndUsd: r.vEndUsd,
        netFlowUsd: r.netFlowUsd,
        gasUsd: r.gasUsd,
        epochHours,
      },
      feedbackURI: reportUrl,
    }, !process.env.CELO_NATIVE_GAS);
    r.agent.history.push({
      epoch: state.epochNumber,
      fitness: r.fitness,
      score,
      vEndUsd: r.vEndUsd,
      gasUsd: r.gasUsd,
      netFlowUsd: r.netFlowUsd,
      epochHours,
    });
    reportRows.push({
      slug: r.agent.slug,
      erc8004AgentId: r.agent.erc8004AgentId,
      strategy: r.agent.strategy,
      generation: r.agent.generation,
      vStartUsd: r.agent.vStartUsd!,
      vEndUsd: r.vEndUsd,
      gasUsd: r.gasUsd,
      netFlowUsd: r.netFlowUsd,
      epochHours,
      fitness: r.fitness,
      score,
      culled: false,
      reputationTx,
    });
    saveState(state);
  }

  // 3. cull bottom 20% (min swarm 5): unwind to treasury + recallChild.
  // Resume safety: if this epoch's cull already ran before a crash, never
  // select a second victim for the same epoch.
  const culls =
    state.lastCulledEpoch === state.epochNumber
      ? []
      : selectCulls(rows.map((r) => ({ ...r, fitness: r.fitness })));
  const culledSlugs: string[] = [];
  let spawnPoolUsd = 0;
  for (const c of culls) {
    const agent = c.agent;
    const account = deriveAccount(agent.hdIndex);
    const reason = `epoch ${state.epochNumber} cull: fitness ${c.fitness.toFixed(3)} in bottom 20% (median ${swarmMedian.toFixed(3)})`;
    const unwound = await unwindAgentToTreasury(account, agent.slug, orch.address, reason, !process.env.CELO_NATIVE_GAS);
    spawnPoolUsd += Number(formatUnits(unwound.sweptUsdm, 18));

    if (agent.childContract) {
      try {
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
      } catch (e) {
        // resume safety: a prior attempt's recall tx can land even when its
        // receipt poll timed out — the retry then reverts "already recalled".
        // That IS the recalled state we wanted; anything else is a real error.
        if (!String((e as Error).message).includes("already recalled")) throw e;
        console.log(`  ${agent.slug}: recallChild already executed onchain (prior attempt's tx landed) — continuing`);
      }
    }
    agent.status = "RETIRED";
    state.lastCulledEpoch = state.epochNumber;
    culledSlugs.push(agent.slug);
    const row = reportRows.find((x) => x.slug === agent.slug);
    if (row) row.culled = true;
    saveState(state);
  }

  // 4. spawn replacements from the top performer's mutated genome —
  // enqueued persistently, then completed (failures retry next cycle)
  let spawnedSlugs: string[] = [];
  if (/^(1|true|yes)$/i.test(process.env.CELO_SKIP_SPAWN ?? "")) {
    console.log(`  CELO_SKIP_SPAWN set — skipping replacement/growth spawn(s) (fork test)`);
  } else {
    const top = rows.reduce((a, b) => (a.fitness >= b.fitness ? a : b)).agent;
    for (let i = 0; i < culls.length; i++) {
      enqueueSpawn(state, top, spawnPoolUsd / culls.length, "cull-replacement");
    }

    // 4b. swarm growth (track 3: every spawn = one new ERC-8004 registration):
    // at most ONE extra spawn per epoch, funded purely from treasury margin
    // recycled out of culled agents' returned balances ($5 legacy stakes vs
    // the $4 funding target). Pure decision rule lives in growth.ts; the
    // deployed-value guard keeps total deployment under TOTAL_BUDGET_USD.
    const activeNow = state.agents.filter((a) => a.status === "ACTIVE").length;
    const pendingNow = state.pendingSpawns?.length ?? 0;
    const deployedUsd =
      activeNow * MAX_AGENT_BALANCE_USD +
      (state.pendingSpawns ?? []).reduce((sum, p) => sum + p.fundUsd, 0);
    const treasuryUsd = Number(formatUnits(await usdmBalance(orch.address), 18));
    const decision = shouldGrowSwarm({
      activeCount: activeNow,
      pendingCount: pendingNow,
      treasuryUsd,
      maxSwarm: MAX_SWARM_SIZE,
      perAgentUsd: MAX_AGENT_BALANCE_USD,
      opsFloatUsd: OPS_FLOAT_USD,
      totalBudgetUsd: TOTAL_BUDGET_USD,
      deployedUsd,
    });
    // resume safety: a crash between the growth enqueue and the epoch advance
    // re-enters settleEpoch and must not enqueue a second growth spawn
    // (observed: three growth spawns piled up across the v5/v6 restarts)
    if (decision.grow && state.lastGrowthEpoch === state.epochNumber) {
      console.log(`  growth: already enqueued for epoch ${state.epochNumber} (crash-resume) — skipping`);
    } else if (decision.grow) {
      enqueueSpawn(state, top, MAX_AGENT_BALANCE_USD, "growth");
      state.lastGrowthEpoch = state.epochNumber;
      saveState(state);
      console.log(`  growth: +1 spawn enqueued from ${top.slug}'s genome — ${decision.reason}`);
    } else {
      console.log(`  growth: not growing — ${decision.reason}`);
    }

    spawnedSlugs = await processPendingSpawns(state);
  }

  const report: EpochReport = {
    epoch: state.epochNumber,
    settledAt: new Date().toISOString(),
    epochHours,
    market: ctx,
    agents: reportRows,
    swarmMedianFitness: swarmMedian,
    culled: culledSlugs,
    spawned: spawnedSlugs,
  };
  // fork tests must not leave synthetic reports in the public docs/ tree
  const epochsDir = /^(1|true|yes)$/i.test(process.env.CELO_NO_PUBLISH ?? "")
    ? "/tmp/celo_fork_epochs"
    : resolve(REPO_ROOT, "docs", "epochs");
  mkdirSync(epochsDir, { recursive: true });
  writeFileSync(resolve(epochsDir, `epoch-${state.epochNumber}.json`), JSON.stringify(report, null, 2) + "\n");
  return report;
}

/** Keep the treasury's USDC pool (the source of x402 signal budgets) topped
 *  up from its cUSD float. The useSignal gene spreads through the population
 *  and each new buyer gets a 0.35 USDC budget at spawn — a fixed pool drains
 *  (observed: ay-chaser-g2-i20 spawned with no budget after i18+i19 emptied
 *  it). Swap is bounded and never touches agent trading capital. */
const USDC_POOL_TARGET_UNITS = 800_000n; // 0.8 USDC
const TREASURY_CUSD_FLOAT_USD = 0.4; // cUSD kept for orchestrator gas, never swapped

async function ensureTreasuryUsdc(minUnits: bigint): Promise<void> {
  const orch = orchestratorAccount();
  const usdc = await celoPublicClient.readContract({
    address: TOKENS.USDC, abi: erc20Abi, functionName: "balanceOf", args: [orch.address],
  });
  if (usdc >= minUnits) return;
  const cusd = Number(formatUnits(await usdmBalance(orch.address), 18));
  const buyUsd = Math.min(
    Number(formatUnits(USDC_POOL_TARGET_UNITS - usdc, 6)),
    cusd - TREASURY_CUSD_FLOAT_USD,
  );
  if (buyUsd < 0.1) {
    console.warn(`  treasury USDC pool low (${formatUnits(usdc, 6)}) but cUSD float ($${cusd.toFixed(2)}) can't replenish it`);
    return;
  }
  try {
    const { executeSwap } = await import("./mento.js");
    await executeSwap({
      account: orch,
      agentId: "orchestrator",
      tokenIn: TOKENS.USDm,
      tokenOut: TOKENS.USDC,
      amountIn: parseUnits(buyUsd.toFixed(6), 18),
      tokenInDecimals: 18,
      tokenOutDecimals: 6,
      usdValue: buyUsd,
      feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
      rationale: `Auto-replenish the treasury's USDC pool ($${buyUsd.toFixed(2)} cUSD -> USDC): the useSignal gene is spreading and every new signal-buying agent receives a 0.35 USDC x402 budget at spawn. Ops capital, not trading capital — agent portfolios untouched.`,
    });
    console.log(`  treasury USDC pool replenished (+$${buyUsd.toFixed(2)})`);
  } catch (e) {
    console.warn(`  treasury USDC replenish failed (${(e as Error).message?.slice(0, 100)}) — will retry when next needed`);
  }
}

/** Top up a useSignal agent's USDC x402 budget BEFORE vStart is captured, so
 *  the transfer lands inside the epoch baseline instead of polluting P&L.
 *  Heals all three observed depletion paths: spawns predating spawn-time
 *  budgets, kill-switch unwinds sweeping USDC home, and plain exhaustion. */
const SIGNAL_BUDGET_UNITS = 200_000n; // 0.20 USDC (~100 calls at $0.002)
const SIGNAL_LOW_WATER_UNITS = 50_000n; // top up below 0.05 USDC

async function ensureSignalBudget(agent: SwarmAgentState): Promise<void> {
  const orch = orchestratorAccount();
  const agentUsdc = await celoPublicClient.readContract({
    address: TOKENS.USDC, abi: erc20Abi, functionName: "balanceOf", args: [agent.address],
  });
  if (agentUsdc >= SIGNAL_LOW_WATER_UNITS) return;
  await ensureTreasuryUsdc(SIGNAL_BUDGET_UNITS);
  const treasuryUsdc = await celoPublicClient.readContract({
    address: TOKENS.USDC, abi: erc20Abi, functionName: "balanceOf", args: [orch.address],
  });
  if (treasuryUsdc < SIGNAL_BUDGET_UNITS) {
    console.warn(`  ${agent.slug}: x402 budget low (${formatUnits(agentUsdc, 6)} USDC) but treasury USDC can't cover a top-up`);
    return;
  }
  assertTxAllowed(0.2, `x402 signal budget top-up for ${agent.slug}`);
  const wallet = celoWalletClient(orch);
  const hash = await wallet.writeContract({
    address: TOKENS.USDC,
    abi: erc20Abi,
    functionName: "transfer",
    args: [agent.address, SIGNAL_BUDGET_UNITS],
    feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
    ...(maybeFee(FEE_CURRENCIES.USDm) ? { gas: 120_000n } : {}),
  });
  await celoPublicClient.waitForTransactionReceipt({ hash });
  logActivity({
    agentId: "orchestrator",
    action: "signal-budget-funding",
    rationale: `Top up ${agent.slug} with 0.2 USDC for x402 signal purchases (balance fell below 0.05 USDC). Done at epoch start before V_start is marked, so the transfer is baseline capital, not P&L.`,
    txHash: hash,
    recipient: agent.address,
  });
  console.log(`  ${agent.slug}: x402 budget topped up +0.2 USDC`);
}

/** Start a new epoch: snapshot market, set vStart, evaluate + execute strategies. */
export async function startEpoch(state: SwarmState): Promise<MarketContext> {
  const ctx = await snapshotMarket(state.prevFxUsdPrice ? { fxUsdPrice: state.prevFxUsdPrice } : undefined);
  const orch = orchestratorAccount();

  for (const agent of state.agents) {
    if (agent.status !== "ACTIVE") continue;
    if (killSwitchEngaged()) throw new Error("kill switch engaged mid-epoch start");
    const account = deriveAccount(agent.hdIndex);
    if (agent.useSignal && !process.env.CELO_NATIVE_GAS) {
      try {
        await ensureSignalBudget(agent);
      } catch (e) {
        console.warn(`  ${agent.slug}: signal budget top-up failed (${(e as Error).message?.slice(0, 100)}) — continuing`);
      }
    }
    const pf = await readPortfolio(agent.address, ctx);
    agent.vStartUsd = pf.totalUsd;
    agent.epochGasUsd = 0;
    agent.epochFlowUsd = 0;

    // Phase 6: useSignal agents pay the x402 oracle for high-resolution FX
    // momentum; it replaces the epoch-boundary momentum for this agent only.
    let agentCtx = ctx;
    if (agent.useSignal && !process.env.CELO_NATIVE_GAS) {
      const { buySignal } = await import("./signal-client.js");
      const bought = await buySignal(account, agent.slug);
      const m = bought?.signal?.fxMomentumBps;
      if (m) {
        agentCtx = {
          ...ctx,
          fxMomentumBps: {
            EURm: m.EURm.h2 ?? m.EURm.h6 ?? ctx.fxMomentumBps.EURm,
            BRLm: m.BRLm.h2 ?? m.BRLm.h6 ?? ctx.fxMomentumBps.BRLm,
          },
        };
      }
    }

    const actions = strategyFor(agent as unknown as AgentSpec).evaluate(agentCtx, pf, agent.params);
    const result = await executeActions(agent, account, orch, actions, state.epochNumber);
    agent.epochGasUsd = result.gasUsd;
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

/** Mid-epoch tick: re-evaluate ACTIVE agents against fresh market data
 *  WITHOUT settling. Strategies are threshold-gated, so most ticks hold;
 *  when a real edge appears intra-epoch, the agent acts on it instead of
 *  waiting up to 4h. Gas accrues to the open epoch's fitness penalty. */
export async function runMidEpochTick(): Promise<void> {
  const state = loadState();
  if (!state) return;
  const ctx = await snapshotMarket(state.prevFxUsdPrice ? { fxUsdPrice: state.prevFxUsdPrice } : undefined);
  const orch = orchestratorAccount();
  for (const agent of state.agents) {
    if (agent.status !== "ACTIVE" || agent.vStartUsd === undefined) continue;
    if (killSwitchEngaged()) throw new Error("kill switch engaged mid-tick");
    const account = deriveAccount(agent.hdIndex);
    const pf = await readPortfolio(agent.address, ctx);
    // useSignal agents refresh their FX momentum mid-epoch the same way they
    // do at epoch start: by buying it from the oracle via x402. The purchase
    // is an agent expense (cuts into its own fitness), so it only makes
    // economic sense because the tick can act on what it learns.
    let agentCtx = ctx;
    if (agent.useSignal && !process.env.CELO_NATIVE_GAS) {
      const { buySignal } = await import("./signal-client.js");
      const bought = await buySignal(account, agent.slug);
      const m = bought?.signal?.fxMomentumBps;
      if (m) {
        agentCtx = {
          ...ctx,
          fxMomentumBps: {
            EURm: m.EURm.m30 ?? m.EURm.h2 ?? ctx.fxMomentumBps.EURm,
            BRLm: m.BRLm.m30 ?? m.BRLm.h2 ?? ctx.fxMomentumBps.BRLm,
          },
        };
      }
    }
    const actions = strategyFor(agent as unknown as AgentSpec)
      .evaluate(agentCtx, pf, agent.params)
      .filter((a) => a.kind !== "hold"); // ticks only act, never narrate holds
    if (actions.length === 0) continue;
    const result = await executeActions(
      agent,
      account,
      orch,
      actions.map((a) => ({ ...a, reason: `[mid-epoch tick] ${a.reason}` })),
      state.epochNumber,
    );
    agent.epochGasUsd = (agent.epochGasUsd ?? 0) + result.gasUsd;
    if (result.executed > 0) {
      console.log(`  tick: ${agent.slug} executed ${result.executed} action(s), gas $${result.gasUsd.toFixed(4)}`);
    }
    saveState(state);
  }
}

/** One full cycle: settle the open epoch (if any), then start the next. */
export async function runEpochCycle(): Promise<void> {
  const state = loadState();
  if (!state) throw new Error("no swarm state — run swarm-start first");

  await sweepRetiredResiduals(state);
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
