import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { JUDGE_FLOW_CONTROL_PATH } from "./judge-flow.js";
import { getBenchmarkYieldWithSource, type BenchmarkYieldResult } from "./aave.js";
import { getLineage, getOnChainGenerationCount } from "./lineage.js";

const BUDGET_STATE_PATH = join(process.cwd(), "..", "runtime_budget_state.json");
const LOG_PATH = join(process.cwd(), "..", "agent_log.json");
const SWARM_STATE_PATH = join(process.cwd(), "..", "swarm_state.json");
const SWARM_EVENTS_PATH = join(process.cwd(), "..", "swarm_events.json");
const JUDGE_FAST_CHILD_INTERVAL_MS = Number(process.env.JUDGE_FAST_CHILD_INTERVAL_MS || 1500);

// Static benchmark used ONLY as a synchronous fallback for shaping file-backed data
// before the live Aave read resolves. The live chain truth is fetched via
// getBenchmarkYieldWithSource() and surfaced with an explicit `source` marker so the
// API/UI can tell a real chain read from this env/static fallback. (P2b)
const BENCHMARK_YIELD_PCT = parseFloat(process.env.AAVE_USDE_BENCHMARK ?? "4.5");

// Cache the live benchmark read briefly so we don't hit RPC on every request.
const BENCHMARK_CACHE_TTL_MS = 30_000;
let benchmarkCache: { at: number; result: BenchmarkYieldResult } | null = null;

async function getCachedBenchmark(): Promise<BenchmarkYieldResult> {
  const now = Date.now();
  if (benchmarkCache && now - benchmarkCache.at < BENCHMARK_CACHE_TTL_MS) {
    return benchmarkCache.result;
  }
  const result = await getBenchmarkYieldWithSource();
  benchmarkCache = { at: now, result };
  return result;
}

// Heuristic: a 32-byte hex string IS a valid tx-hash shape, but in dry-run mode the
// runtime fills these with deterministic pseudo-hashes (keccak of a seed string) that
// are NOT real on-chain txs. We can't distinguish a pseudo-hash from a real hash by
// shape alone, so we rely on the runtime's own `isLive`/`dryRun` provenance to mark
// them. This flag is attached to API payloads so the dashboard never renders a
// simulated hash as a real Mantlescan link. (P2c)
function markSimulatedTx(hash: unknown, isSimulated: boolean): { txHash: string | null; simulated: boolean } | null {
  if (typeof hash !== "string" || hash.length === 0) return null;
  return { txHash: hash, simulated: isSimulated };
}

type JudgeEvent = {
  action: string;
  at: string;
  status: "pending" | "success" | "failed";
  txHash?: string;
  txHashes?: string[];
  filecoinCid?: string;
  filecoinUrl?: string;
  validationRequestId?: string;
  respawnedChild?: string;
  lineageSourceCid?: string;
  details?: string;
};

type JudgeFlowState = {
  runId: string | null;
  status: "idle" | "queued" | "running" | "failed" | "completed";
  governor: string;
  childCycleIntervalMs?: number;
  proofChildLabel?: string;
  proofChildAgentId?: string;
  respawnedChildLabel?: string;
  respawnedChildAgentId?: string;
  proposalId?: string;
  forcedScore: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  failureReason?: string;
  filecoinCid?: string;
  filecoinUrl?: string;
  validationRequestId?: string;
  validationTxHash?: string;
  validationResponseTxHash?: string;
  reputationTxHash?: string;
  alignmentTxHash?: string;
  terminationTxHash?: string;
  proposalTxHash?: string;
  respawnTxHash?: string;
  voteTxHash?: string;
  lineageSourceCid?: string;
  requestedAt?: string;
  events: JudgeEvent[];
};

type JudgeExecutionLog = {
  timestamp: string;
  phase: string;
  action: string;
  details: string;
  chain?: string;
  txHash?: string;
  txHashes?: string[];
  ensLabel?: string;
  status: string;
  judgeRunId?: string;
  judgeStep?: string;
  proofChild?: boolean;
  proofStatus?: string;
  filecoinCid?: string;
  filecoinUrl?: string;
  validationRequestId?: string;
  respawnedChild?: string;
  lineageSourceCid?: string;
};

type JudgeReceipt = {
  runId: string;
  status: JudgeFlowState["status"];
  governor: string;
  proofChildLabel?: string;
  proofChildAgentId?: string;
  respawnedChildLabel?: string;
  respawnedChildAgentId?: string;
  proposalId?: string;
  forcedScore: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  failureReason?: string;
  filecoinCid?: string;
  filecoinUrl?: string;
  validationRequestId?: string;
  validationTxHash?: string;
  validationResponseTxHash?: string;
  reputationTxHash?: string;
  alignmentTxHash?: string;
  terminationTxHash?: string;
  proposalTxHash?: string;
  respawnTxHash?: string;
  voteTxHash?: string;
  lineageSourceCid?: string;
  decision?: string;
  litEncrypted?: boolean;
  reasoningHash?: string;
  veniceTokensUsed?: number;
  veniceCallsUsed?: number;
  events: JudgeEvent[];
  executionLogs: JudgeExecutionLog[];
};

// JSON-safe mirror of ChildState (bigint serialized as string)
type SwarmChildState = {
  pid: number;
  contractAddress: string;
  walletAddress: string;
  agentId: string;
  lineageKey: string;
  generation: number;
  spawnTime: number;
  cycleCount: number;
  currentYieldPct: number;
  benchmarkYieldPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  consecutiveBelowThreshold: number;
  positionSummary: string;
  status: "ACTIVE" | "TERMINATED" | "RESPAWNING";
  ipfsCid?: string;
  mantleSpawnTxHash: string;
  mantleRecallTxHash?: string;
};

type SwarmStateResponse = {
  agents: SwarmChildState[];
  cycleCount: number;
  uptime: number;
  isLive: boolean;
  lastEvaluation: number;
  swarmStartTime: number;
};

type SwarmEvent = {
  type: "SPAWN" | "TERMINATION" | "YIELD_REPORT" | "RESPAWN" | "GENERATION_RESULT";
  timestamp: number;
  lineageKey: string;
  generation: number;
  data: Record<string, unknown>;
};

type GenerationResult = {
  lineageKey: string;
  generation: number;
  avgYieldPct: number;
  benchmarkYieldPct: number;
  agentsTerminated: number;
  riskAdjustedScore: number;
  mantlescanLink: string;
  // P2c: true when this result's tx hash is a dry-run pseudo-hash (not a real tx).
  txSimulated: boolean;
};

type SwarmStateFile = Partial<SwarmStateResponse> & {
  children?: SwarmChildState[];
  updatedAt?: string;
};

type SwarmEventsFile = {
  updatedAt?: string;
  events?: unknown[];
};

type OldSwarmEvent = {
  type?: string;
  timestamp?: string | number;
  lineageKey?: string;
  generation?: number;
  agentLabel?: string;
  txHash?: string;
  contractAddress?: string;
  avgRiskAdjustedScore?: number;
  avgYieldPct?: number;
  benchmarkYieldPct?: number;
  currentYieldPct?: number;
  actionTaken?: string;
  failureReason?: string;
  ipfsCid?: string;
  recallTxHash?: string;
  mantleRecallTxHash?: string;
  newAgentLabel?: string;
  lineageDepth?: number;
  spawnTxHash?: string;
  mantleSpawnTxHash?: string;
  mantleTxHash?: string;
  agentsTerminated?: number;
  riskAdjustedScore?: number;
  data?: Record<string, unknown>;
};

const CONTROL_SERVER_START_TIME = Date.now();

const EMPTY_STATE = {
  runId: null,
  status: "idle",
  governor: "uniswap",
  forcedScore: 15,
  events: [],
};

const EMPTY_BUDGET_STATE = {
  policy: "normal",
  reasons: [],
  context: "unavailable",
  parentEthBalanceWei: "0",
  parentEthBalance: "0.0000",
  warningEth: "0.0300",
  pauseEth: "0.0150",
  veniceCalls: 0,
  veniceTokens: 0,
  warningTokens: 200000,
  pauseTokens: 350000,
  activeChildren: 0,
  filecoinAvailable: false,
  pauseProposalCreation: false,
  pauseScaling: false,
  pauseJudgeFlow: false,
  lastUpdatedAt: null,
};

function applyCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  applyCors(res);
  res.end(JSON.stringify(body));
}

function safeReadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function normalizeJudgeChildCycleInterval(body: Record<string, unknown>): number | undefined {
  const explicit = Number(body.childCycleIntervalMs);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  if (body.fastMode === true) return JUDGE_FAST_CHILD_INTERVAL_MS;
  return undefined;
}

function extractDetailValue(details: string | undefined, key: string): string | undefined {
  if (!details) return undefined;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = details.match(new RegExp(`${escapedKey}=([^,)]+)`));
  return match?.[1];
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toBoolean(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function labelLineageKey(label: string): string {
  return label.replace(/-v\d+$/, "");
}

function labelGeneration(label: string): number {
  const m = label.match(/-v(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

function deriveStateFromLog(): SwarmChildState[] {
  const raw = safeReadJson<{ executionLogs?: any[] }>(LOG_PATH);
  const logs = raw?.executionLogs ?? [];
  const children = new Map<string, SwarmChildState>();

  for (const log of logs) {
    if (log.action === "spawn_child" && log.ensLabel) {
      const label: string = log.ensLabel;
      children.set(label, {
        pid: 0,
        contractAddress:
          typeof log.childAddress === "string" && log.childAddress.startsWith("0x")
            ? log.childAddress
            : "0x0000000000000000000000000000000000000000",
        walletAddress: "0x0000000000000000000000000000000000000000",
        agentId: String(log.erc8004AgentId ?? 0),
        lineageKey: labelLineageKey(label),
        generation: labelGeneration(label),
        spawnTime: new Date(log.timestamp).getTime(),
        cycleCount: 0,
        currentYieldPct: 0,
        benchmarkYieldPct: BENCHMARK_YIELD_PCT,
        maxDrawdownPct: 0,
        riskAdjustedScore: 0,
        consecutiveBelowThreshold: 0,
        positionSummary: "governance-based swarm",
        status: "ACTIVE",
        mantleSpawnTxHash: log.txHash ?? "",
      });
    }

    if (log.action === "terminate_and_respawn" && log.terminatedChild) {
      const c = children.get(log.terminatedChild);
      if (c) {
        c.status = "TERMINATED";
        c.riskAdjustedScore =
          typeof log.terminatedAlignment === "number" ? log.terminatedAlignment - 50 : -10;
        c.mantleRecallTxHash = log.respawnTxHash ?? log.txHash;
      }
    }

    if (log.action === "terminate_child" && log.terminatedChild) {
      const c = children.get(log.terminatedChild);
      if (c) {
        c.status = "TERMINATED";
        c.mantleRecallTxHash = log.txHash;
      }
    }

    if (log.action === "evaluate_alignment" && log.ensLabel) {
      children.get(log.ensLabel as string)?.cycleCount !== undefined &&
        (children.get(log.ensLabel as string)!.cycleCount++);
    }
  }

  return [...children.values()];
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function timestampMs(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function liveModeFromEnv(): boolean {
  return (
    process.env.ALLOW_LIVE_SPAWN === "true" ||
    process.env.ALLOW_LIVE_RECALL === "true" ||
    process.env.ALLOW_LIVE_CHILD_WRITES === "true" ||
    process.env.ALLOW_LIVE_GENERATION_POSTS === "true"
  );
}

function readSwarmStateResponse(): SwarmStateResponse {
  const fromFile = safeReadJson<SwarmStateFile>(SWARM_STATE_PATH);
  const agents = Array.isArray(fromFile?.agents)
    ? fromFile.agents
    : Array.isArray(fromFile?.children)
      ? fromFile.children
      : deriveStateFromLog();
  const fallbackStart =
    agents.length > 0
      ? Math.min(...agents.map((agent) => timestampMs(agent.spawnTime, CONTROL_SERVER_START_TIME)))
      : CONTROL_SERVER_START_TIME;
  const swarmStartTime = timestampMs(fromFile?.swarmStartTime, fallbackStart);

  return {
    agents,
    cycleCount: numberOr(
      fromFile?.cycleCount,
      agents.reduce((max, agent) => Math.max(max, numberOr(agent.cycleCount, 0)), 0)
    ),
    uptime: Math.max(0, Date.now() - swarmStartTime),
    isLive: typeof fromFile?.isLive === "boolean" ? fromFile.isLive : liveModeFromEnv(),
    lastEvaluation: timestampMs(fromFile?.lastEvaluation, 0),
    swarmStartTime,
  };
}

function toEventType(value: unknown): SwarmEvent["type"] | null {
  if (
    value === "SPAWN" ||
    value === "TERMINATION" ||
    value === "YIELD_REPORT" ||
    value === "RESPAWN" ||
    value === "GENERATION_RESULT"
  ) {
    return value;
  }
  return null;
}

function normalizeSwarmEvent(raw: unknown): SwarmEvent | null {
  const event = raw as OldSwarmEvent;
  const type = toEventType(event?.type);
  if (!event || !type || typeof event.lineageKey !== "string") return null;

  const data =
    event.data && typeof event.data === "object" && !Array.isArray(event.data)
      ? { ...event.data }
      : {};

  if (event.agentLabel !== undefined) data.agentLabel = event.agentLabel;
  if (event.txHash !== undefined) data.txHash = event.txHash;
  if (event.contractAddress !== undefined) data.contractAddress = event.contractAddress;
  if (event.currentYieldPct !== undefined) data.currentYieldPct = event.currentYieldPct;
  if (event.actionTaken !== undefined) data.actionTaken = event.actionTaken;
  if (event.failureReason !== undefined) data.failureReason = event.failureReason;
  if (event.ipfsCid !== undefined) data.ipfsCid = event.ipfsCid;
  if (event.newAgentLabel !== undefined) data.newAgentLabel = event.newAgentLabel;
  if (event.lineageDepth !== undefined) data.lineageDepth = event.lineageDepth;

  if (type === "SPAWN" || type === "RESPAWN") {
    data.mantleSpawnTxHash =
      data.mantleSpawnTxHash ?? event.mantleSpawnTxHash ?? event.spawnTxHash ?? event.txHash ?? null;
  }

  if (type === "TERMINATION") {
    data.mantleRecallTxHash =
      data.mantleRecallTxHash ?? event.mantleRecallTxHash ?? event.recallTxHash ?? event.txHash ?? null;
  }

  if (type === "GENERATION_RESULT") {
    data.avgYieldPct = data.avgYieldPct ?? event.avgYieldPct ?? 0;
    data.benchmarkYieldPct = data.benchmarkYieldPct ?? event.benchmarkYieldPct ?? BENCHMARK_YIELD_PCT;
    data.agentsTerminated = data.agentsTerminated ?? event.agentsTerminated ?? 0;
    data.riskAdjustedScore =
      data.riskAdjustedScore ?? event.riskAdjustedScore ?? event.avgRiskAdjustedScore ?? 0;
    data.mantleTxHash = data.mantleTxHash ?? event.mantleTxHash ?? event.txHash ?? null;
  }

  return {
    type,
    timestamp: timestampMs(event.timestamp),
    lineageKey: event.lineageKey,
    generation: numberOr(event.generation, 1),
    data,
  };
}

function deriveEventsFromLog(): SwarmEvent[] {
  const raw = safeReadJson<{ executionLogs?: any[] }>(LOG_PATH);
  const logs = raw?.executionLogs ?? [];
  const events: SwarmEvent[] = [];

  for (const log of logs) {
    const ts = timestampMs(log.timestamp);

    if (log.action === "spawn_child" && log.ensLabel) {
      const label: string = log.ensLabel;
      events.push({
        type: "SPAWN",
        timestamp: ts,
        lineageKey: labelLineageKey(label),
        generation: labelGeneration(label),
        data: {
          agentLabel: label,
          txHash: log.txHash,
          contractAddress:
            typeof log.childAddress === "string" && log.childAddress.startsWith("0x")
              ? log.childAddress
              : undefined,
          mantleSpawnTxHash: log.txHash ?? null,
        },
      });
    }

    if (log.action === "terminate_and_respawn") {
      const termLabel: string = log.terminatedChild ?? "";
      if (termLabel) {
        events.push({
          type: "TERMINATION",
          timestamp: ts,
          lineageKey: labelLineageKey(termLabel),
          generation: labelGeneration(termLabel),
          data: {
            agentLabel: termLabel,
            failureReason: `alignment_score_${log.terminatedAlignment ?? "unknown"}`,
            mantleRecallTxHash: log.respawnTxHash ?? log.txHash ?? null,
            txHash: log.respawnTxHash ?? log.txHash,
          },
        });
      }
      const respawnLabel: string = log.respawnedChild ?? "";
      if (respawnLabel) {
        const gen = labelGeneration(respawnLabel);
        events.push({
          type: "RESPAWN",
          timestamp: ts,
          lineageKey: labelLineageKey(respawnLabel),
          generation: gen,
          data: {
            agentLabel: respawnLabel,
            txHash: log.respawnTxHash,
            mantleSpawnTxHash: log.respawnTxHash ?? null,
            newAgentLabel: respawnLabel,
            lineageDepth: gen,
          },
        });
      }
    }

    if (log.action === "terminate_child" && log.terminatedChild) {
      const termLabel: string = log.terminatedChild;
      events.push({
        type: "TERMINATION",
        timestamp: ts,
        lineageKey: labelLineageKey(termLabel),
        generation: labelGeneration(termLabel),
        data: {
          agentLabel: termLabel,
          txHash: log.txHash,
          failureReason: typeof log.details === "string" ? log.details.slice(0, 200) : undefined,
          mantleRecallTxHash: log.txHash ?? null,
        },
      });
    }

    if (log.action === "evaluate_alignment" && log.ensLabel) {
      const label: string = log.ensLabel;
      events.push({
        type: "YIELD_REPORT",
        timestamp: ts,
        lineageKey: labelLineageKey(label),
        generation: labelGeneration(label),
        data: {
          agentLabel: label,
          txHash: log.txHash,
          currentYieldPct: 0,
          actionTaken: "evaluate_alignment",
        },
      });
    }
  }

  return events.sort((a, b) => a.timestamp - b.timestamp);
}

function readSwarmEvents(): SwarmEvent[] {
  const fromFile = safeReadJson<SwarmEventsFile>(SWARM_EVENTS_PATH);
  const source = Array.isArray(fromFile?.events) ? fromFile.events : deriveEventsFromLog();
  return source
    .map(normalizeSwarmEvent)
    .filter((event): event is SwarmEvent => event !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function readGenerationResults(): GenerationResult[] {
  const latestByKey = new Map<string, SwarmEvent>();
  for (const event of readSwarmEvents()) {
    if (event.type !== "GENERATION_RESULT") continue;
    latestByKey.set(`${event.lineageKey}:${event.generation}`, event);
  }

  return [...latestByKey.values()]
    .sort((a, b) => a.lineageKey.localeCompare(b.lineageKey) || a.generation - b.generation)
    .map((event) => {
      const mantleTxHash = typeof event.data.mantleTxHash === "string" ? event.data.mantleTxHash : "";
      // The runtime tags dry-run generation posts with data.dryRun=true; a pseudo-hash
      // produced in dry-run is NOT a real Mantle tx, so don't render it as a live link.
      const txSimulated = event.data.dryRun === true;
      return {
        lineageKey: event.lineageKey,
        generation: event.generation,
        avgYieldPct: numberOr(event.data.avgYieldPct, 0),
        benchmarkYieldPct: numberOr(event.data.benchmarkYieldPct, BENCHMARK_YIELD_PCT),
        agentsTerminated: numberOr(event.data.agentsTerminated, 0),
        riskAdjustedScore: numberOr(event.data.riskAdjustedScore, 0),
        // Only emit a clickable explorer link for real (non-simulated) txs. (P2c)
        mantlescanLink: mantleTxHash && !txSimulated ? `https://mantlescan.xyz/tx/${mantleTxHash}` : "",
        txSimulated,
      };
    });
}

async function readLineage(lineageKey: string) {
  const state = readSwarmStateResponse();
  const events = readSwarmEvents();
  const cids = new Set<string>();
  let fileGenerationCount = 0;

  for (const agent of state.agents) {
    if (agent.lineageKey !== lineageKey) continue;
    fileGenerationCount = Math.max(fileGenerationCount, numberOr(agent.generation, 0));
    if (agent.ipfsCid) cids.add(agent.ipfsCid);
  }

  for (const event of events) {
    if (event.lineageKey !== lineageKey) continue;
    fileGenerationCount = Math.max(fileGenerationCount, numberOr(event.generation, 0));
    if (typeof event.data.ipfsCid === "string") cids.add(event.data.ipfsCid);
  }

  // P2a: prefer on-chain truth from the LineageRegistry. Read the on-chain CID list
  // and generation count; fall back to file-derived values only if the chain read is
  // unavailable, and label which source the response actually used.
  const [chainCids, chainGenerationCount] = await Promise.all([
    getLineage(lineageKey).catch(() => [] as string[]),
    getOnChainGenerationCount(lineageKey),
  ]);

  for (const cid of chainCids) {
    if (typeof cid === "string" && cid.length > 0) cids.add(cid);
  }

  const generationCountSource =
    chainGenerationCount !== null && chainGenerationCount > 0 ? "chain" : "file";
  const generationCount =
    generationCountSource === "chain" ? chainGenerationCount! : fileGenerationCount;

  return {
    lineageKey,
    cids: [...cids],
    generationCount,
    onChainGenerationCount: chainGenerationCount,
    onChainCidCount: chainCids.length,
    generationCountSource,
    cidSource: chainCids.length > 0 ? "chain+file" : "file",
  };
}

function normalizeEvent(log: JudgeExecutionLog): JudgeEvent {
  return {
    action: log.action,
    at: log.timestamp,
    status: (log.status === "failed" ? "failed" : "success") as JudgeEvent["status"],
    txHash: log.txHash,
    txHashes: log.txHashes,
    filecoinCid: log.filecoinCid,
    filecoinUrl: log.filecoinUrl,
    validationRequestId: log.validationRequestId,
    respawnedChild: log.respawnedChild,
    lineageSourceCid: log.lineageSourceCid,
    details: log.details,
  };
}

function dedupeEvents(
  stateEvents: JudgeEvent[] | undefined,
  executionLogs: JudgeExecutionLog[]
): JudgeEvent[] {
  const byAction = new Map<string, JudgeEvent>();
  for (const event of stateEvents ?? []) byAction.set(event.action, event);
  for (const log of executionLogs) {
    const current = byAction.get(log.action);
    byAction.set(log.action, {
      ...current,
      ...normalizeEvent(log),
      action: log.action,
      at: current?.at ?? log.timestamp,
    });
  }
  return [...byAction.values()].sort((a, b) => a.at.localeCompare(b.at));
}

function getJudgeReceipt(runId: string): JudgeReceipt | null {
  const rawLog = safeReadJson<{ executionLogs?: JudgeExecutionLog[] }>(LOG_PATH);
  const executionLogs = (rawLog?.executionLogs ?? [])
    .filter((entry) => entry.judgeRunId === runId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const state = safeReadJson<JudgeFlowState>(JUDGE_FLOW_CONTROL_PATH);
  const currentState = state?.runId === runId ? state : null;

  if (!currentState && executionLogs.length === 0) return null;

  const eventByAction = new Map(executionLogs.map((entry) => [entry.action, entry]));
  const voteLog = eventByAction.get("judge_vote_cast");
  const alignmentLog = eventByAction.get("judge_alignment_forced");
  const filecoinLog = eventByAction.get("judge_termination_report_filecoin");
  const validationLog = eventByAction.get("judge_validation_written");
  const respawnLog = eventByAction.get("judge_child_respawned");
  const startedAt = currentState?.startedAt ?? executionLogs[0]?.timestamp;
  const completedAt = currentState?.completedAt ?? executionLogs[executionLogs.length - 1]?.timestamp;
  const durationMs =
    currentState?.durationMs ??
    (startedAt && completedAt
      ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
      : undefined);

  return {
    runId,
    status:
      currentState?.status ??
      (executionLogs.some((entry) => entry.status === "failed")
        ? "failed"
        : executionLogs.some((entry) => entry.action === "judge_flow_completed")
        ? "completed"
        : "running"),
    governor:
      currentState?.governor ??
      extractDetailValue(eventByAction.get("judge_child_spawned")?.details, "governor") ??
      "uniswap",
    proofChildLabel:
      currentState?.proofChildLabel ??
      eventByAction.get("judge_child_spawned")?.ensLabel ??
      extractDetailValue(eventByAction.get("judge_child_spawned")?.details, "ensLabel"),
    proofChildAgentId:
      currentState?.proofChildAgentId ??
      extractDetailValue(alignmentLog?.details, "erc8004AgentId"),
    respawnedChildLabel:
      currentState?.respawnedChildLabel ??
      respawnLog?.respawnedChild ??
      extractDetailValue(respawnLog?.details, "respawnedChild"),
    respawnedChildAgentId: currentState?.respawnedChildAgentId,
    proposalId:
      currentState?.proposalId ??
      extractDetailValue(voteLog?.details, "proposalId"),
    forcedScore:
      currentState?.forcedScore ??
      toNumber(extractDetailValue(alignmentLog?.details, "forcedScore")) ??
      15,
    startedAt,
    completedAt,
    durationMs,
    failureReason: currentState?.failureReason,
    filecoinCid: currentState?.filecoinCid ?? filecoinLog?.filecoinCid,
    filecoinUrl: currentState?.filecoinUrl ?? filecoinLog?.filecoinUrl,
    validationRequestId:
      currentState?.validationRequestId ?? validationLog?.validationRequestId,
    validationTxHash: currentState?.validationTxHash ?? validationLog?.txHashes?.[0],
    validationResponseTxHash:
      currentState?.validationResponseTxHash ?? validationLog?.txHash ?? validationLog?.txHashes?.[1],
    reputationTxHash:
      currentState?.reputationTxHash ?? eventByAction.get("judge_reputation_written")?.txHash,
    alignmentTxHash:
      currentState?.alignmentTxHash ?? alignmentLog?.txHash,
    terminationTxHash:
      currentState?.terminationTxHash ?? eventByAction.get("judge_child_terminated")?.txHash,
    proposalTxHash:
      currentState?.proposalTxHash ?? eventByAction.get("judge_proposal_seeded")?.txHash,
    respawnTxHash:
      currentState?.respawnTxHash ?? respawnLog?.txHash,
    voteTxHash: currentState?.voteTxHash ?? voteLog?.txHash,
    lineageSourceCid:
      currentState?.lineageSourceCid ?? respawnLog?.lineageSourceCid ?? filecoinLog?.lineageSourceCid,
    decision: extractDetailValue(voteLog?.details, "decision"),
    litEncrypted: toBoolean(extractDetailValue(voteLog?.details, "litEncrypted")),
    reasoningHash: extractDetailValue(voteLog?.details, "reasoningHash"),
    veniceTokensUsed: toNumber(extractDetailValue(voteLog?.details, "veniceTokensUsed")),
    veniceCallsUsed: toNumber(extractDetailValue(voteLog?.details, "veniceCallsUsed")),
    events: dedupeEvents(currentState?.events, executionLogs),
    executionLogs,
  };
}

export function startControlServer() {
  if (process.env.JUDGE_FLOW_HTTP_ENABLED === "false") return;

  const port = Number(process.env.PORT || process.env.JUDGE_FLOW_CONTROL_PORT || 8787);
  const host = "0.0.0.0";

  const server = createServer(async (req, res) => {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (method === "OPTIONS") {
      applyCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === "GET" && url.pathname === "/health") {
      const state = readSwarmStateResponse();
      const benchmark = await getCachedBenchmark();
      return json(res, 200, {
        status: "ok",
        uptime: state.uptime,
        cycleCount: state.cycleCount,
        // Live Aave benchmark with explicit source so the UI never treats the static
        // env fallback as a live chain read. (P2a/P2b)
        benchmark: {
          benchmarkYieldPct: benchmark.benchmarkYieldPct,
          liveAaveYieldPct: benchmark.liveAaveYieldPct,
          source: benchmark.source,
        },
      });
    }

    if (method === "GET" && url.pathname === "/judge-flow") {
      const current = safeReadJson<JudgeFlowState>(JUDGE_FLOW_CONTROL_PATH);
      return json(res, 200, current ? { ...EMPTY_STATE, ...current, events: current.events ?? [] } : EMPTY_STATE);
    }

    if (method === "GET" && url.pathname === "/budget") {
      const current = safeReadJson<any>(BUDGET_STATE_PATH);
      return json(
        res,
        200,
        current ? { ...EMPTY_BUDGET_STATE, ...current, context: current.context || "agent_runtime" } : EMPTY_BUDGET_STATE
      );
    }

    if (method === "POST" && url.pathname === "/judge-flow/start") {
      const body = await readBody(req);
      const current = existsSync(JUDGE_FLOW_CONTROL_PATH)
        ? { ...EMPTY_STATE, ...(safeReadJson<JudgeFlowState>(JUDGE_FLOW_CONTROL_PATH) ?? {}) }
        : EMPTY_STATE;

      if (current.status === "queued" || current.status === "running") {
        return json(res, 409, { error: `Judge flow already ${current.status}`, current });
      }

      if (existsSync(BUDGET_STATE_PATH)) {
        const budget = safeReadJson<any>(BUDGET_STATE_PATH);
        if (budget?.pauseJudgeFlow) {
          return json(res, 409, {
            error: `Judge flow paused by runtime budget policy (${budget.policy || "paused"})`,
            budget,
          });
        }
      }

      const runId = body.runId || `judge-${Date.now()}`;
      const next = {
        runId,
        status: "queued",
        governor: body.governor || "uniswap",
        childCycleIntervalMs: normalizeJudgeChildCycleInterval(body),
        forcedScore: Number(body.forcedScore || 15),
        requestedAt: new Date().toISOString(),
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
        failureReason: undefined,
        proofChildLabel: undefined,
        proofChildAgentId: undefined,
        respawnedChildLabel: undefined,
        respawnedChildAgentId: undefined,
        proposalId: undefined,
        proposalDescription: undefined,
        filecoinCid: undefined,
        filecoinUrl: undefined,
        validationRequestId: undefined,
        validationTxHash: undefined,
        validationResponseTxHash: undefined,
        reputationTxHash: undefined,
        alignmentTxHash: undefined,
        terminationTxHash: undefined,
        proposalTxHash: undefined,
        respawnTxHash: undefined,
        voteTxHash: undefined,
        lineageSourceCid: undefined,
        events: [],
      };

      writeFileSync(JUDGE_FLOW_CONTROL_PATH, JSON.stringify(next, null, 2));
      return json(res, 200, next);
    }

    if (method === "GET" && url.pathname.startsWith("/receipt/")) {
      const runId = decodeURIComponent(url.pathname.slice("/receipt/".length));
      const receipt = getJudgeReceipt(runId);
      if (!receipt) {
        return json(res, 404, { error: `No judge receipt found for ${runId}` });
      }
      return json(res, 200, receipt);
    }

    if (method === "GET" && url.pathname === "/api/state") {
      const state = readSwarmStateResponse();
      // P2a/P2b: enrich the file-backed state with the live Aave benchmark read so
      // the API reflects chain truth, not just the last value the runtime wrote to
      // disk. Fall back to the file/env value on RPC failure, clearly labeled.
      const benchmark = await getCachedBenchmark();
      const isSimulatedRuntime = state.isLive !== true;
      return json(res, 200, {
        ...state,
        // Mark every surfaced spawn/recall tx hash with its simulated provenance. (P2c)
        agents: state.agents.map((agent) => ({
          ...agent,
          // Prefer the live chain benchmark; keep the per-agent recorded value too.
          liveBenchmarkYieldPct: benchmark.benchmarkYieldPct,
          mantleSpawnTx: markSimulatedTx(agent.mantleSpawnTxHash, isSimulatedRuntime),
          mantleRecallTx: markSimulatedTx(agent.mantleRecallTxHash, isSimulatedRuntime),
        })),
        benchmark: {
          benchmarkYieldPct: benchmark.benchmarkYieldPct,
          liveAaveYieldPct: benchmark.liveAaveYieldPct,
          source: benchmark.source, // "live" | "fallback"
        },
        txHashesSimulated: isSimulatedRuntime,
      });
    }

    if (method === "GET" && url.pathname === "/api/events") {
      const events = readSwarmEvents();
      return json(res, 200, {
        events: events.slice(-200),
        total: events.length,
      });
    }

    if (method === "GET" && url.pathname === "/api/generations") {
      const benchmark = await getCachedBenchmark();
      return json(res, 200, {
        generations: readGenerationResults(),
        // Live Aave benchmark + source, so the dashboard can show chain truth instead
        // of only the static benchmark baked into recorded events. (P2a/P2b)
        benchmark: {
          benchmarkYieldPct: benchmark.benchmarkYieldPct,
          liveAaveYieldPct: benchmark.liveAaveYieldPct,
          source: benchmark.source,
        },
      });
    }

    if (method === "GET" && url.pathname.startsWith("/api/lineage/")) {
      const lineageKey = decodeURIComponent(url.pathname.slice("/api/lineage/".length));
      return json(res, 200, await readLineage(lineageKey));
    }

    return json(res, 404, { error: "Not found" });
  });

  server.listen(port, host, () => {
    console.log(`[Control] Judge flow control API listening on http://${host}:${port}`);
  });
}
