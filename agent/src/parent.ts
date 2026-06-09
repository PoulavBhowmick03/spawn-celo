import { fork, type ChildProcess } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { decodeEventLog, formatUnits, getAddress, keccak256, parseEther, parseUnits, stringToHex, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ChildAgentABI, SpawnFactoryABI } from "./abis.js";
import { getWalletClient, publicClient } from "./chain.js";
import { getBenchmarkYield, getUSDEAavePosition, withdrawFromAave } from "./aave.js";
import { startControlServer } from "./control-server.js";
import { pinToIPFS } from "./ipfs.js";
import { postGenerationResult, pushLineageCID } from "./lineage.js";
import type { ChildIPCReport, ChildState } from "./types.js";
import { generateGenerationSummary, generatePostMortem } from "./venice.js";
import type { ChildRuntimeConfig, ChildStrategyProfile } from "./child.js";

type SwarmEvent = {
  type: "SPAWN" | "TERMINATION" | "YIELD_REPORT" | "RESPAWN" | "GENERATION_RESULT";
  timestamp: number;
  lineageKey: string;
  generation: number;
  data: Record<string, unknown>;
};

type SerializedChildState = Omit<ChildState, "agentId"> & { agentId: string };

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

type ChildReportEnvelope = {
  type: "YIELD_REPORT";
  report: ChildIPCReport;
  cycleCount: number;
  actionTaken: string;
  rationale: string;
  decisionHash: `0x${string}`;
  decisionPayload: string;
  decisionPromptPrefix: string;
  decisionTimestamp: number;
  amountBps: number;
};

type ChildErrorEnvelope = {
  type: "ERROR";
  walletAddress: string;
  error: string;
  timestamp: number;
};

type ManagedChild = {
  process: ChildProcess;
  state: ChildState;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const SWARM_STATE_PATH = join(REPO_ROOT, "swarm_state.json");
const SWARM_EVENTS_PATH = join(REPO_ROOT, "swarm_events.json");
const LOCAL_CID_DIR = join(REPO_ROOT, "runtime_ipfs");

const CHILD_COUNT = Number(process.env.SWARM_CHILD_COUNT || "5");
const CHILD_INTERVAL_MS = Number(process.env.CHILD_CYCLE_INTERVAL_MS || "30000");
const EVALUATION_INTERVAL_MS = Number(process.env.PARENT_EVALUATION_INTERVAL_MS || "75000");
// Live Aave V3 USDe supply APY on Mantle as of 2026-05-13: 4.30-4.63%
// Updated from stale benchmark which was incorrect
const DEFAULT_BENCHMARK_PCT = parseFloat(
  process.env.AAVE_USDE_BENCHMARK ?? "4.50"
);
// Threshold: riskAdjustedScore below this for 2 consecutive cycles triggers termination.
// Formula: (excessYield / drawdown) + activityScore - volatilityPenalty
// With typical 4.5% benchmark and 1 trade/cycle, scores cluster 0.2–1.4.
// 0.5 requires slight positive performance. 3.0 was too aggressive for small positions.
const TERMINATION_THRESHOLD = parseFloat(
  process.env.RISK_THRESHOLD ?? "0.5"
);
const CHILD_SEED_USDE = 15;

const STRATEGY_PROFILES: ChildStrategyProfile[] = [
  {
    id: "conservative-carry",
    label: "Conservative Carry",
    systemPrompt:
      "Prioritize capital preservation. Prefer Aave USDe, keep meaningful dry powder, and avoid moving cash unless the adjusted APY advantage is clear.",
    targetAaveUSDeBps: 7_000,
    targetCashBps: 3_000,
    maxTradeBps: 7_000,
    minimumSpreadBps: 55,
    yieldBiasBps: { usde: 8, meth: -85, moe: -70 },
    yieldNoiseBps: 5,
    riskScoreModifier: 0.18,
  },
  {
    id: "balanced-carry",
    label: "Balanced Carry",
    systemPrompt:
      "Run a steady USDe carry book. Deploy most cash to Aave USDe, preserve enough cash to respond to recalls, and rebalance only on moderate adjusted spreads.",
    targetAaveUSDeBps: 8_000,
    targetCashBps: 2_000,
    maxTradeBps: 8_000,
    minimumSpreadBps: 30,
    yieldBiasBps: { usde: 0, meth: -55, moe: -35 },
    yieldNoiseBps: 8,
    riskScoreModifier: 0.04,
  },
  {
    id: "aggressive-carry",
    label: "Aggressive Carry",
    systemPrompt:
      "Maximize productive USDe carry. Prefer being nearly fully deployed in Aave USDe and tolerate smaller adjusted spread uncertainty before acting.",
    targetAaveUSDeBps: 9_500,
    targetCashBps: 500,
    maxTradeBps: 9_500,
    minimumSpreadBps: 15,
    yieldBiasBps: { usde: 22, meth: -40, moe: -15 },
    yieldNoiseBps: 14,
    riskScoreModifier: -0.14,
  },
  {
    id: "dry-powder-rotator",
    label: "Dry Powder Rotator",
    systemPrompt:
      "Keep a larger reserve for successor optionality. Deploy only a modest Aave USDe base position and require a high adjusted spread before increasing exposure.",
    targetAaveUSDeBps: 5_500,
    targetCashBps: 4_500,
    maxTradeBps: 5_500,
    minimumSpreadBps: 80,
    yieldBiasBps: { usde: -10, meth: -90, moe: -45 },
    yieldNoiseBps: 10,
    riskScoreModifier: 0.24,
  },
  {
    id: "moe-scout",
    label: "Moe Scout",
    systemPrompt:
      "Watch Merchant Moe as an experimental route, but do not add LP unless its adjusted APY beats Aave USDe after risk and liquidity penalties. Keep cash available for that optionality.",
    targetAaveUSDeBps: 6_500,
    targetCashBps: 3_500,
    maxTradeBps: 6_500,
    minimumSpreadBps: 45,
    yieldBiasBps: { usde: -4, meth: -70, moe: 65 },
    yieldNoiseBps: 18,
    riskScoreModifier: -0.08,
  },
];

/**
 * FUND RECOVERY: If parent.ts crashes with active children, recover funds by
 * deriving each child wallet from TREASURY_PRIVATE_KEY, lineageKey, and
 * generation, then sweeping USDe back to treasury manually.
 *
 * Known lineage keys are `usde-yield-agent-${index}` for 0 <= index < CHILD_COUNT.
 * Generation tracking is persisted in swarm_state.json every cycle.
 */

const managedChildren = new Map<string, ManagedChild>();
const recentlyTerminatedChildren: SerializedChildState[] = [];
const swarmEvents: SwarmEvent[] = [];
const terminationLocks = new Set<string>();
let decisionProofQueue: Promise<void> = Promise.resolve();
let parentCycleCount = 0;
let lastEvaluation = 0;
const swarmStartTime = Date.now();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function labelFor(lineageKey: string, generation: number) {
  return `${lineageKey}-v${generation}`;
}

function strategyProfileForLineage(lineageKey: string): ChildStrategyProfile {
  const match = lineageKey.match(/-(\d+)$/);
  const index = match ? Number(match[1]) : 0;
  return STRATEGY_PROFILES[index % STRATEGY_PROFILES.length] ?? STRATEGY_PROFILES[0];
}

function pseudoHash(seed: string): `0x${string}` {
  return keccak256(stringToHex(seed));
}

function pseudoAddress(seed: string): `0x${string}` {
  const hash = pseudoHash(seed);
  return getAddress(`0x${hash.slice(-40)}`) as `0x${string}`;
}

function serializeChildState(state: ChildState): SerializedChildState {
  return {
    ...state,
    agentId: state.agentId.toString(),
  };
}

function isLiveRuntime() {
  return (
    process.env.ALLOW_LIVE_SPAWN === "true" ||
    process.env.ALLOW_LIVE_RECALL === "true" ||
    process.env.ALLOW_LIVE_CHILD_WRITES === "true" ||
    process.env.ALLOW_LIVE_GENERATION_POSTS === "true"
  );
}

function persistedAgents() {
  const byAddress = new Map<string, SerializedChildState>();
  for (const state of recentlyTerminatedChildren) {
    byAddress.set(state.contractAddress.toLowerCase(), state);
  }
  for (const { state } of managedChildren.values()) {
    byAddress.set(state.contractAddress.toLowerCase(), serializeChildState(state));
  }

  return [...byAddress.values()].sort(
    (a, b) => a.lineageKey.localeCompare(b.lineageKey) || a.generation - b.generation
  );
}

function rememberTerminatedChild(state: ChildState) {
  const serialized = serializeChildState(state);
  const key = serialized.contractAddress.toLowerCase();
  const existingIndex = recentlyTerminatedChildren.findIndex(
    (child) => child.contractAddress.toLowerCase() === key
  );
  if (existingIndex >= 0) recentlyTerminatedChildren.splice(existingIndex, 1);
  recentlyTerminatedChildren.unshift(serialized);
  if (recentlyTerminatedChildren.length > 50) recentlyTerminatedChildren.length = 50;
}

function persistSwarmState() {
  const agents = persistedAgents();

  writeFileSync(
    SWARM_STATE_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        agents,
        children: agents,
        cycleCount: parentCycleCount,
        uptime: Date.now() - swarmStartTime,
        isLive: isLiveRuntime(),
        lastEvaluation,
        swarmStartTime,
      },
      null,
      2
    )
  );
}

function persistSwarmEvents() {
  writeFileSync(
    SWARM_EVENTS_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), events: swarmEvents }, null, 2)
  );
}

function recordEvent(event: SwarmEvent) {
  swarmEvents.push(event);
  persistSwarmEvents();
}

function logEvaluation(state: ChildState) {
  console.log(
    `[Parent] ${labelFor(state.lineageKey, state.generation)} | yield=${state.currentYieldPct.toFixed(4)}% | ` +
      `benchmark=${state.benchmarkYieldPct.toFixed(4)}% | riskAdjusted=${state.riskAdjustedScore.toFixed(4)} | ` +
      `drawdown=${state.maxDrawdownPct.toFixed(4)}% | below=${state.consecutiveBelowThreshold}`
  );
}

function updateRiskMetrics(state: ChildState, report: ChildIPCReport, cycleCount: number) {
  state.cycleCount = cycleCount;
  state.currentYieldPct = report.currentYieldPct;
  state.maxDrawdownPct = Math.max(state.maxDrawdownPct, report.drawdownPct);
  state.positionSummary = report.positionSummary;

  // Risk formula v2 — not gameable by HOLD strategy
  // activityScore rewards actual trading decisions (capped to prevent abuse)
  // drawdownDenom uses tighter floor (0.003 not 0.01) to avoid score inflation
  // volatilityPenalty punishes erratic yield swings
  const scoringYieldPct = report.adjustedYieldPct ?? report.currentYieldPct;
  const excessYield = scoringYieldPct - state.benchmarkYieldPct;
  const numTrades = report.numTradesLastEval ?? 0;
  const stdDevYield = report.stdDevYieldLastEval ?? 0;
  const riskProfileModifier = report.riskProfileModifier ?? 0;

  const activityScore = Math.min(numTrades * 1.2, 6.0);
  const drawdownDenom = Math.max(Math.abs(state.maxDrawdownPct), 0.003);
  const volatilityPenalty = Math.max(0, stdDevYield - 0.5);

  state.riskAdjustedScore =
    (excessYield / drawdownDenom) + activityScore - volatilityPenalty + riskProfileModifier;

  if (state.riskAdjustedScore < TERMINATION_THRESHOLD) {
    state.consecutiveBelowThreshold++;
  } else {
    state.consecutiveBelowThreshold = 0;
  }
}

function terminatedCountForLineage(lineageKey: string) {
  return swarmEvents.filter((event) => event.type === "TERMINATION" && event.lineageKey === lineageKey).length;
}

async function postEvaluationResultIfEnabled(state: ChildState) {
  const liveGenerationPosts = process.env.ALLOW_LIVE_GENERATION_POSTS === "true";
  const agentsTerminated = terminatedCountForLineage(state.lineageKey);
  let mantleTxHash: string | null = null;

  if (!liveGenerationPosts) {
    console.log(`[Parent] DRY RUN: would post generation result for ${labelFor(state.lineageKey, state.generation)}`);
    mantleTxHash = pseudoHash(
      `generation-result:${state.lineageKey}:${state.generation}:${state.currentYieldPct}:${agentsTerminated}:${Date.now()}`
    );
  } else {
    try {
      const summary = await generateGenerationSummary(state);
      const avgYieldBps = Math.round(state.currentYieldPct * 100);
      mantleTxHash = await postGenerationResult(
        state.lineageKey,
        summary,
        avgYieldBps,
        agentsTerminated,
        state.generation
      );
      if (mantleTxHash) {
        console.log(`[Parent] Posted GenerationResult for ${labelFor(state.lineageKey, state.generation)} → ${mantleTxHash}`);
      }
    } catch (error: any) {
      console.warn(`[Parent] GenerationResult post failed: ${error?.message ?? String(error)}`);
    }
  }

  recordEvent({
    type: "GENERATION_RESULT",
    timestamp: Date.now(),
    lineageKey: state.lineageKey,
    generation: state.generation,
    data: {
      agentLabel: labelFor(state.lineageKey, state.generation),
      avgYieldPct: state.currentYieldPct,
      benchmarkYieldPct: state.benchmarkYieldPct,
      agentsTerminated,
      riskAdjustedScore: state.riskAdjustedScore,
      mantleTxHash,
      dryRun: !liveGenerationPosts,
    },
  });
}

function localCIDPath(cid: string) {
  return join(LOCAL_CID_DIR, `${cid.replace(/^local:/, "")}.json`);
}

function storeLocalCID(data: unknown, lineageKey: string, generation: number): string {
  mkdirSync(LOCAL_CID_DIR, { recursive: true });
  const cid = `local:${lineageKey}-g${generation}-${Date.now()}`;
  writeFileSync(localCIDPath(cid), JSON.stringify(data, null, 2));
  return cid;
}

function forkChild(config: ChildRuntimeConfig) {
  const childPath = fileURLToPath(new URL("./child.ts", import.meta.url));
  const childEnv = { ...process.env };
  delete childEnv.TREASURY_PRIVATE_KEY;
  delete childEnv.DEPLOYER_PRIVATE_KEY;

  return fork(childPath, [], {
    cwd: join(REPO_ROOT, "agent"),
    env: {
      ...childEnv,
      CHILD_CONFIG: JSON.stringify(config),
      CHILD_PRIVATE_KEY: config.privateKey,
      CHILD_WALLET_ADDRESS: config.walletAddress,
      CHILD_CONTRACT_ADDRESS: config.contractAddress,
      CHILD_SEED_USDE: String(CHILD_SEED_USDE),
    },
    execArgv: ["--import", "tsx"],
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
}

function normalizePrivateKey(privateKey: string): `0x${string}` {
  return (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
}

/**
 * KEY DERIVATION RISK (5d) — READ BEFORE GOING LIVE WITH REAL FUNDS:
 *
 * Each child wallet's private key is derived deterministically as
 *   keccak256(`${TREASURY_PRIVATE_KEY}:${lineageKey}:${generation}`)
 * The `lineageKey` and `generation` inputs are PUBLIC (emitted on-chain in spawn
 * events and written to swarm_state.json). Therefore the ONLY secret protecting
 * every child wallet is the treasury key itself: anyone who learns
 * TREASURY_PRIVATE_KEY can regenerate every child private key and drain all child
 * wallets. This is acceptable only because the treasury already owns those funds —
 * but it means the treasury key's blast radius is the entire swarm.
 *
 * SEPARATE DEPLOYER/TREASURY KEYS: the runtime supports distinct keys —
 *   - DEPLOYER_PRIVATE_KEY: spawn/recall/decision-proof contract writes + (default)
 *     child gas funding.
 *   - TREASURY_PRIVATE_KEY: holds USDe, seeds children, and is the child-key
 *     derivation root + sweep destination.
 *   - CHILD_GAS_FUNDER_PRIVATE_KEY: optional override for gas, else DEPLOYER.
 * Child keys are derived ONLY from the treasury key (never the deployer key), so
 * setting DEPLOYER != TREASURY correctly isolates contract-admin authority from
 * fund-custody authority. Do NOT switch the derivation root to the deployer key
 * without re-deriving/sweeping existing child wallets first.
 */
function deriveChildWallet(
  lineageKey: string,
  generation: number
): { privateKey: `0x${string}`; address: `0x${string}` } {
  const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
  if (!treasuryKey) throw new Error("TREASURY_PRIVATE_KEY not set");

  // Derivation root is intentionally the TREASURY key (fund custodian), independent
  // of DEPLOYER. When the two keys differ, child funds remain recoverable solely via
  // the treasury key while contract-admin actions use the deployer key.
  const normalizedTreasuryKey = normalizePrivateKey(treasuryKey);
  const childPrivateKey = keccak256(toBytes(`${normalizedTreasuryKey}:${lineageKey}:${generation}`));
  const account = privateKeyToAccount(childPrivateKey);

  return {
    privateKey: childPrivateKey,
    address: account.address,
  };
}

async function spawnOnChainIfPossible(
  lineageKey: string,
  generation: number,
  walletAddress: `0x${string}`
) {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  const factoryAddress = process.env.SPAWN_FACTORY_ADDRESS;
  const liveSpawnsEnabled = process.env.ALLOW_LIVE_SPAWN === "true";

  if (!liveSpawnsEnabled || !deployerKey || !factoryAddress) {
    const txHash = pseudoHash(`spawn:${lineageKey}:${generation}:${walletAddress}:${Date.now()}`);
    return {
      child: pseudoAddress(`child:${lineageKey}:${generation}:${Date.now()}`),
      agentId: BigInt(generation),
      txHash,
    };
  }

  const normalizedKey = (deployerKey.startsWith("0x") ? deployerKey : `0x${deployerKey}`) as `0x${string}`;
  const walletClient = getWalletClient(normalizedKey);
  const txHash = await walletClient.writeContract({
    address: factoryAddress as `0x${string}`,
    abi: SpawnFactoryABI,
    functionName: "spawnChild",
    args: [lineageKey, BigInt(generation), walletAddress],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: SpawnFactoryABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "ChildSpawned") {
        const args = decoded.args as {
          child: `0x${string}`;
          agentId: bigint;
        };
        return { child: args.child, agentId: args.agentId, txHash };
      }
    } catch {
      continue;
    }
  }

  return {
    child: pseudoAddress(`child:${lineageKey}:${generation}:${txHash}`),
    agentId: 0n,
    txHash,
  };
}

async function recallOnChainIfPossible(contractAddress: string, reason: string, cid: string) {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  const liveRecallsEnabled = process.env.ALLOW_LIVE_RECALL === "true";
  if (!liveRecallsEnabled || !deployerKey || !contractAddress.startsWith("0x")) {
    return pseudoHash(`recall:${contractAddress}:${reason}:${cid}:${Date.now()}`);
  }

  const normalizedKey = (deployerKey.startsWith("0x") ? deployerKey : `0x${deployerKey}`) as `0x${string}`;
  const walletClient = getWalletClient(normalizedKey);
  const txHash = await walletClient.writeContract({
    address: contractAddress as `0x${string}`,
    abi: ChildAgentABI,
    functionName: "recallChild",
    args: [reason, cid],
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

async function recordDecisionHashIfEnabled(
  contractAddress: string,
  decisionHash: `0x${string}`,
  actionType: string,
  amountBps: number
) {
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  const liveProofsEnabled =
    process.env.ALLOW_LIVE_CHILD_WRITES === "true" &&
    process.env.ALLOW_LIVE_SPAWN === "true";

  if (!liveProofsEnabled || !deployerKey || !contractAddress.startsWith("0x")) {
    return;
  }

  try {
    const walletClient = getWalletClient(normalizePrivateKey(deployerKey));
    const txHash = await walletClient.writeContract({
      address: contractAddress as `0x${string}`,
      abi: ChildAgentABI,
      functionName: "recordDecisionHash",
      args: [decisionHash, actionType, BigInt(Math.round(amountBps))],
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Parent] Recorded decision proof ${decisionHash} for ${contractAddress} -> ${txHash}`);
  } catch (err: any) {
    console.warn("[Parent] recordDecisionHash failed (non-blocking):", err?.message ?? String(err));
  }
}

function enqueueDecisionProof(
  contractAddress: string,
  decisionHash: `0x${string}`,
  actionType: string,
  amountBps: number
) {
  decisionProofQueue = decisionProofQueue
    .then(() => recordDecisionHashIfEnabled(contractAddress, decisionHash, actionType, amountBps))
    .catch((err: any) => {
      console.warn("[Parent] decision proof queue failed (non-blocking):", err?.message ?? String(err));
    });
}

async function fundChildWallet(
  childWalletAddress: `0x${string}`,
  seedAmountUSD: number = 15
): Promise<string> {
  const liveWritesEnabled = process.env.ALLOW_LIVE_CHILD_WRITES === "true";
  const usdeAddress = process.env.USDE_ADDRESS as `0x${string}`;
  const usdeDecimals = parseInt(process.env.USDE_DECIMALS ?? "18", 10);
  const gasStipend = parseEther(process.env.CHILD_GAS_STIPEND_MNT ?? "0.05");

  if (!liveWritesEnabled) {
    console.log(
      `[Parent] DRY RUN: would fund ${childWalletAddress} with $${seedAmountUSD} USDe and ` +
        `${process.env.CHILD_GAS_STIPEND_MNT ?? "0.05"} MNT`
    );
    return "0xDRYRUN";
  }

  if (!usdeAddress || usdeAddress.startsWith("0x_")) {
    throw new Error("[fundChildWallet] USDE_ADDRESS not set — cannot fund child wallet");
  }

  const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
  if (!treasuryKey) {
    throw new Error("[fundChildWallet] TREASURY_PRIVATE_KEY not set");
  }

  const walletClient = getWalletClient(normalizePrivateKey(treasuryKey));
  const amount = parseUnits(seedAmountUSD.toString(), usdeDecimals);

  const balance = await publicClient.readContract({
    address: usdeAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [walletClient.account.address],
  }) as bigint;

  if (balance < amount) {
    throw new Error(
      `[fundChildWallet] Treasury USDe balance (${balance}) < seed amount (${amount}). ` +
      `Fund the treasury wallet at ${walletClient.account.address} before launching.`
    );
  }

  const hash = await walletClient.writeContract({
    address: usdeAddress,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [childWalletAddress, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[Parent] Funded ${childWalletAddress} with $${seedAmountUSD} USDe → ${hash}`);

  if (gasStipend > 0n) {
    const gasFunderKey = process.env.CHILD_GAS_FUNDER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
    if (!gasFunderKey) {
      throw new Error("[fundChildWallet] DEPLOYER_PRIVATE_KEY or CHILD_GAS_FUNDER_PRIVATE_KEY required for child gas");
    }

    const gasWalletClient = getWalletClient(normalizePrivateKey(gasFunderKey));
    const gasBalance = await publicClient.getBalance({ address: gasWalletClient.account.address });
    if (gasBalance < gasStipend) {
      throw new Error(
        `[fundChildWallet] Gas funder MNT balance (${gasBalance}) < child gas stipend (${gasStipend}).`
      );
    }

    const gasHash = await gasWalletClient.sendTransaction({
      to: childWalletAddress,
      value: gasStipend,
    });
    await publicClient.waitForTransactionReceipt({ hash: gasHash });
    console.log(`[Parent] Funded ${childWalletAddress} with ${process.env.CHILD_GAS_STIPEND_MNT ?? "0.05"} MNT → ${gasHash}`);
  }

  return hash;
}

async function spawnManagedChild(lineageKey: string, generation: number, eventType: "SPAWN" | "RESPAWN") {
  const { privateKey: childPrivateKey, address: walletAddress } = deriveChildWallet(lineageKey, generation);
  const strategyProfile = strategyProfileForLineage(lineageKey);

  try {
    await fundChildWallet(walletAddress, CHILD_SEED_USDE);
  } catch (err) {
    console.error(`[Parent] fundChildWallet failed for ${walletAddress}:`, err);
    return;
  }

  const deployment = await spawnOnChainIfPossible(lineageKey, generation, walletAddress);
  const benchmarkYieldPct = await getBenchmarkYield();

  const config: ChildRuntimeConfig = {
    lineageKey,
    generation,
    contractAddress: deployment.child,
    walletAddress,
    agentId: deployment.agentId.toString(),
    benchmarkYieldPct,
    cycleIntervalMs: CHILD_INTERVAL_MS,
    spawnTxHash: deployment.txHash,
    privateKey: childPrivateKey,
    dryRun: process.env.ALLOW_LIVE_CHILD_WRITES !== "true",
    strategyProfile,
  };

  const childProcess = forkChild(config);
  const state: ChildState = {
    pid: childProcess.pid ?? 0,
    contractAddress: config.contractAddress,
    walletAddress: config.walletAddress,
    agentId: deployment.agentId,
    lineageKey,
    generation,
    spawnTime: Date.now(),
    cycleCount: 0,
    currentYieldPct: 0,
    benchmarkYieldPct,
    maxDrawdownPct: 0,
    riskAdjustedScore: 0,
    consecutiveBelowThreshold: 0,
    positionSummary: "booting child runtime",
    status: "ACTIVE",
    mantleSpawnTxHash: config.spawnTxHash,
  };

  managedChildren.set(config.contractAddress.toLowerCase(), { process: childProcess, state });
  persistSwarmState();

  const label = labelFor(lineageKey, generation);
  recordEvent({
    type: eventType,
    timestamp: Date.now(),
    lineageKey,
    generation,
    data: {
      agentLabel: label,
      contractAddress: config.contractAddress,
      walletAddress: config.walletAddress,
      agentId: deployment.agentId.toString(),
      mantleSpawnTxHash: config.spawnTxHash,
      txHash: config.spawnTxHash,
      strategyProfile: {
        id: strategyProfile.id,
        label: strategyProfile.label,
        targetAaveUSDeBps: strategyProfile.targetAaveUSDeBps,
        targetCashBps: strategyProfile.targetCashBps,
        yieldBiasBps: strategyProfile.yieldBiasBps,
        riskScoreModifier: strategyProfile.riskScoreModifier,
      },
      newAgentLabel: eventType === "RESPAWN" ? label : undefined,
      lineageDepth: generation,
    },
  });

  childProcess.on("message", async (message: ChildReportEnvelope | ChildErrorEnvelope) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "YIELD_REPORT") {
      const managed = managedChildren.get(config.contractAddress.toLowerCase());
      if (!managed || managed.state.status !== "ACTIVE") return;

      updateRiskMetrics(managed.state, message.report, message.cycleCount);
      persistSwarmState();
      recordEvent({
        type: "YIELD_REPORT",
        timestamp: message.report.timestamp,
        lineageKey,
        generation,
        data: {
          agentLabel: label,
          contractAddress: config.contractAddress,
          walletAddress: config.walletAddress,
          currentYieldPct: message.report.currentYieldPct,
          adjustedYieldPct: message.report.adjustedYieldPct,
          actionTaken: message.actionTaken,
          rationale: message.rationale,
          positionSummary: message.report.positionSummary,
          decisionHash: message.decisionHash,
          decisionPayload: message.decisionPayload,
          decisionPromptPrefix: message.decisionPromptPrefix,
          decisionTimestamp: message.decisionTimestamp,
          amountBps: message.amountBps,
        },
      });
      enqueueDecisionProof(
        config.contractAddress,
        message.decisionHash,
        message.actionTaken,
        message.amountBps
      );
    } else if (message.type === "ERROR") {
      console.error(`[Parent] Child error from ${label}: ${message.error}`);
    }
  });

  childProcess.on("exit", (code, signal) => {
    const managed = managedChildren.get(config.contractAddress.toLowerCase());
    if (!managed) return;
    if (managed.state.status === "RESPAWNING" || managed.state.status === "TERMINATED") return;
    managed.state.status = "TERMINATED";
    managed.state.positionSummary = `child process exited (code=${code ?? "null"}, signal=${signal ?? "none"})`;
    rememberTerminatedChild(managed.state);
    persistSwarmState();
  });

  console.log(
    `[Parent] Spawned ${label} | profile=${strategyProfile.id} | contract=${config.contractAddress} | wallet=${config.walletAddress} | agentId=${deployment.agentId.toString()}`
  );
}

async function sweepChildFunds(
  lineageKey: string,
  generation: number,
  childWalletAddress: `0x${string}`
): Promise<void> {
  const label = labelFor(lineageKey, generation);

  if (process.env.ALLOW_LIVE_CHILD_WRITES !== "true") {
    console.log(`[Sweep] DRY RUN: would sweep funds from ${childWalletAddress} → treasury`);
    return;
  }

  const treasuryKeyRaw = process.env.TREASURY_PRIVATE_KEY;
  if (!treasuryKeyRaw) {
    console.warn(`[Sweep] ${label}: TREASURY_PRIVATE_KEY not set — skipping fund sweep`);
    return;
  }
  // Sweep destination is the treasury (fund custodian), which may be a DIFFERENT key
  // than the deployer. Normalize for 0x-prefix tolerance. (5d)
  const treasuryAddress = privateKeyToAccount(normalizePrivateKey(treasuryKeyRaw)).address;
  const { privateKey: childPrivateKey } = deriveChildWallet(lineageKey, generation);

  // 1. Withdraw any Aave USDe position back to the child wallet first
  try {
    const aaveBalance = await getUSDEAavePosition(childWalletAddress);
    if (aaveBalance > 0.01) {
      console.log(`[Sweep] ${label}: withdrawing $${aaveBalance.toFixed(4)} USDe from Aave`);
      await withdrawFromAave(childPrivateKey, "USDE", aaveBalance);
    }
  } catch (err: any) {
    console.warn(`[Sweep] ${label}: Aave withdraw failed — ${err?.message ?? String(err)}`);
  }

  // 2. Transfer all USDe from child wallet to treasury
  const usdeAddr = process.env.USDE_ADDRESS as `0x${string}` | undefined;
  if (usdeAddr) {
    try {
      const usdeBalance = await publicClient.readContract({
        address: usdeAddr,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [childWalletAddress],
      }) as bigint;
      if (usdeBalance > 0n) {
        const walletClient = getWalletClient(childPrivateKey);
        const hash = await walletClient.writeContract({
          address: usdeAddr,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [treasuryAddress, usdeBalance],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        console.log(`[Sweep] ${label}: returned ${formatUnits(usdeBalance, 18)} USDe → treasury (${hash})`);
      }
    } catch (err: any) {
      console.warn(`[Sweep] ${label}: USDe transfer failed — ${err?.message ?? String(err)}`);
    }
  }

  // 3. Transfer remaining MNT to treasury, keeping 0.005 MNT as gas buffer
  const GAS_BUFFER = parseEther("0.005");
  try {
    const mntBalance = await publicClient.getBalance({ address: childWalletAddress });
    const sweepable = mntBalance > GAS_BUFFER ? mntBalance - GAS_BUFFER : 0n;
    if (sweepable > 0n) {
      const walletClient = getWalletClient(childPrivateKey);
      const hash = await walletClient.sendTransaction({
        to: treasuryAddress,
        value: sweepable,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`[Sweep] ${label}: returned ${formatUnits(sweepable, 18)} MNT → treasury (${hash})`);
    }
  } catch (err: any) {
    console.warn(`[Sweep] ${label}: MNT transfer failed — ${err?.message ?? String(err)}`);
  }
}

async function terminateAndRespawn(managed: ManagedChild) {
  const key = managed.state.contractAddress.toLowerCase();
  if (terminationLocks.has(key)) return;
  terminationLocks.add(key);

  try {
    managed.state.status = "RESPAWNING";
    persistSwarmState();

    const reason =
      `Two consecutive evaluations below threshold: yield ${managed.state.currentYieldPct.toFixed(4)}%, ` +
      `benchmark ${managed.state.benchmarkYieldPct.toFixed(4)}%, risk-adjusted ${managed.state.riskAdjustedScore.toFixed(4)}.`;

    const draftPostMortem = await generatePostMortem(managed.state);

    let cid: string;
    try {
      cid = await pinToIPFS({ ...draftPostMortem, mantleRecallTxHash: "pending" });
    } catch {
      console.warn(
        `[Parent] WARNING: Filebase upload failed — using local fallback CID for ${managed.state.lineageKey}. ` +
          `Local CIDs are not publicly resolvable and are NOT acceptable as judge evidence. ` +
          `Fix FILEBASE_API_KEY and FILEBASE_SECRET before final submission.`
      );
      cid = storeLocalCID(draftPostMortem, managed.state.lineageKey, managed.state.generation);
    }

    const recallTxHash = await recallOnChainIfPossible(managed.state.contractAddress, reason, cid);
    const fullPostMortem = { ...draftPostMortem, mantleRecallTxHash: recallTxHash };

    if (cid.startsWith("local:")) {
      writeFileSync(localCIDPath(cid), JSON.stringify(fullPostMortem, null, 2));
    }

    if (process.env.ALLOW_LIVE_RECALL === "true") {
      await pushLineageCID(managed.state.lineageKey, cid).catch((err) => {
        console.error(`[Parent] pushLineageCID failed for ${managed.state.lineageKey}:`, err);
      });
    } else {
      console.log(
        `[Parent] DRY RUN: would push lineage CID ${cid} for ${managed.state.lineageKey}`
      );
    }

    managed.state.status = "TERMINATED";
    managed.state.ipfsCid = cid;
    managed.state.mantleRecallTxHash = recallTxHash;
    rememberTerminatedChild(managed.state);
    persistSwarmState();

    recordEvent({
      type: "TERMINATION",
      timestamp: Date.now(),
      lineageKey: managed.state.lineageKey,
      generation: managed.state.generation,
      data: {
        agentLabel: labelFor(managed.state.lineageKey, managed.state.generation),
        contractAddress: managed.state.contractAddress,
        walletAddress: managed.state.walletAddress,
        txHash: recallTxHash,
        mantleRecallTxHash: recallTxHash,
        failureReason: reason,
        ipfsCid: cid,
        inheritanceConstraints: draftPostMortem.inheritanceConstraints,
      },
    });

    managed.process.kill("SIGTERM");
    managedChildren.delete(key);

    await sleep(500);

    await sweepChildFunds(
      managed.state.lineageKey,
      managed.state.generation,
      managed.state.walletAddress as `0x${string}`
    );

    await spawnManagedChild(
      managed.state.lineageKey,
      managed.state.generation + 1,
      "RESPAWN"
    );
  } finally {
    terminationLocks.delete(key);
  }
}

async function evaluationLoop() {
  while (true) {
    for (const managed of managedChildren.values()) {
      if (managed.state.status !== "ACTIVE") continue;
      // Grace period: skip termination evaluation for the first 3 cycles so the
      // agent has time to deploy capital and read ancestor context from IPFS.
      if (managed.state.cycleCount < 3) continue;
      logEvaluation(managed.state);
      await postEvaluationResultIfEnabled(managed.state);
      if (managed.state.consecutiveBelowThreshold >= 2) {
        await terminateAndRespawn(managed);
      }
    }
    parentCycleCount++;
    lastEvaluation = Date.now();
    persistSwarmState();
    persistSwarmEvents();
    await sleep(EVALUATION_INTERVAL_MS);
  }
}

export async function runParentLoop() {
  startControlServer();
  mkdirSync(LOCAL_CID_DIR, { recursive: true });
  persistSwarmState();
  persistSwarmEvents();

  for (let index = 0; index < CHILD_COUNT; index++) {
    await spawnManagedChild(`usde-yield-agent-${index}`, 1, "SPAWN");
  }

  await evaluationLoop();
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runParentLoop().catch((error) => {
    console.error("[Parent] Fatal:", error);
    process.exitCode = 1;
  });
}
