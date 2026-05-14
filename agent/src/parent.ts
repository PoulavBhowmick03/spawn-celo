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
import type { ChildRuntimeConfig } from "./child.js";

type SwarmEvent = {
  type: "SPAWN" | "YIELD_REPORT" | "TERMINATION" | "RESPAWN";
  timestamp: string;
  lineageKey: string;
  generation: number;
  agentLabel: string;
  txHash?: string;
  contractAddress?: string;
  currentYieldPct?: number;
  actionTaken?: string;
  failureReason?: string;
  ipfsCid?: string;
  recallTxHash?: string;
  newAgentLabel?: string;
  lineageDepth?: number;
  spawnTxHash?: string;
  inheritanceConstraints?: string[];
};

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
const BENCHMARK_YIELD_PCT = Number(process.env.AAVE_USDE_BENCHMARK || "7.47");
const RISK_THRESHOLD = Number(process.env.RISK_THRESHOLD || "0");

/**
 * FUND RECOVERY: If parent.ts crashes with active children, recover funds by
 * deriving each child wallet from TREASURY_PRIVATE_KEY, lineageKey, and
 * generation, then sweeping USDe back to treasury manually.
 *
 * Known lineage keys are `usde-yield-agent-${index}` for 0 <= index < CHILD_COUNT.
 * Generation tracking is persisted in swarm_state.json every cycle.
 */

const managedChildren = new Map<string, ManagedChild>();
const swarmEvents: SwarmEvent[] = [];
const terminationLocks = new Set<string>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function labelFor(lineageKey: string, generation: number) {
  return `${lineageKey}-v${generation}`;
}

function pseudoHash(seed: string): `0x${string}` {
  return keccak256(stringToHex(seed));
}

function pseudoAddress(seed: string): `0x${string}` {
  const hash = pseudoHash(seed);
  return getAddress(`0x${hash.slice(-40)}`) as `0x${string}`;
}

function serializeChildState(state: ChildState) {
  return {
    ...state,
    agentId: state.agentId.toString(),
  };
}

function persistSwarmState() {
  const children = [...managedChildren.values()]
    .map(({ state }) => serializeChildState(state))
    .sort((a, b) => a.lineageKey.localeCompare(b.lineageKey) || a.generation - b.generation);

  writeFileSync(
    SWARM_STATE_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), children }, null, 2)
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
  state.riskAdjustedScore =
    (state.currentYieldPct - state.benchmarkYieldPct) / Math.abs(report.drawdownPct || 0.01);
  state.consecutiveBelowThreshold =
    state.riskAdjustedScore < RISK_THRESHOLD ? state.consecutiveBelowThreshold + 1 : 0;
}

function terminatedCountForLineage(lineageKey: string) {
  return swarmEvents.filter((event) => event.type === "TERMINATION" && event.lineageKey === lineageKey).length;
}

async function postEvaluationResultIfEnabled(state: ChildState) {
  if (process.env.ALLOW_LIVE_GENERATION_POSTS !== "true") return;

  try {
    const summary = await generateGenerationSummary(state);
    const avgYieldBps = Math.round(state.currentYieldPct * 100);
    const txHash = await postGenerationResult(
      state.lineageKey,
      summary,
      avgYieldBps,
      terminatedCountForLineage(state.lineageKey),
      state.generation
    );
    if (txHash) {
      console.log(`[Parent] Posted GenerationResult for ${labelFor(state.lineageKey, state.generation)} → ${txHash}`);
    }
  } catch (error: any) {
    console.warn(`[Parent] GenerationResult post failed: ${error?.message ?? String(error)}`);
  }
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
    },
    execArgv: ["--import", "tsx"],
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
}

function normalizePrivateKey(privateKey: string): `0x${string}` {
  return (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
}

function deriveChildWallet(
  lineageKey: string,
  generation: number
): { privateKey: `0x${string}`; address: `0x${string}` } {
  const treasuryKey = process.env.TREASURY_PRIVATE_KEY;
  if (!treasuryKey) throw new Error("TREASURY_PRIVATE_KEY not set");

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

  try {
    await fundChildWallet(walletAddress, 15);
  } catch (err) {
    console.error(`[Parent] fundChildWallet failed for ${walletAddress}:`, err);
    return;
  }

  const deployment = await spawnOnChainIfPossible(lineageKey, generation, walletAddress);

  const config: ChildRuntimeConfig = {
    lineageKey,
    generation,
    contractAddress: deployment.child,
    walletAddress,
    agentId: deployment.agentId.toString(),
    benchmarkYieldPct: BENCHMARK_YIELD_PCT,
    cycleIntervalMs: CHILD_INTERVAL_MS,
    spawnTxHash: deployment.txHash,
    privateKey: childPrivateKey,
    dryRun: process.env.ALLOW_LIVE_CHILD_WRITES !== "true",
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
    benchmarkYieldPct: BENCHMARK_YIELD_PCT,
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
    timestamp: new Date().toISOString(),
    lineageKey,
    generation,
    agentLabel: label,
    contractAddress: config.contractAddress,
    txHash: config.spawnTxHash,
    spawnTxHash: config.spawnTxHash,
    newAgentLabel: eventType === "RESPAWN" ? label : undefined,
    lineageDepth: generation,
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
        timestamp: new Date(message.report.timestamp).toISOString(),
        lineageKey,
        generation,
        agentLabel: label,
        contractAddress: config.contractAddress,
        currentYieldPct: message.report.currentYieldPct,
        actionTaken: message.actionTaken,
      });
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
    persistSwarmState();
  });

  console.log(
    `[Parent] Spawned ${label} | contract=${config.contractAddress} | wallet=${config.walletAddress} | agentId=${deployment.agentId.toString()}`
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

  const treasuryKey = process.env.TREASURY_PRIVATE_KEY as `0x${string}` | undefined;
  if (!treasuryKey) {
    console.warn(`[Sweep] ${label}: TREASURY_PRIVATE_KEY not set — skipping fund sweep`);
    return;
  }
  const treasuryAddress = privateKeyToAccount(treasuryKey).address;
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
      cid = storeLocalCID(draftPostMortem, managed.state.lineageKey, managed.state.generation);
    }

    const recallTxHash = await recallOnChainIfPossible(managed.state.contractAddress, reason, cid);
    const fullPostMortem = { ...draftPostMortem, mantleRecallTxHash: recallTxHash };

    if (cid.startsWith("local:")) {
      writeFileSync(localCIDPath(cid), JSON.stringify(fullPostMortem, null, 2));
    }

    await pushLineageCID(managed.state.lineageKey, cid).catch(() => null);

    managed.state.status = "TERMINATED";
    managed.state.ipfsCid = cid;
    managed.state.mantleRecallTxHash = recallTxHash;
    persistSwarmState();

    recordEvent({
      type: "TERMINATION",
      timestamp: new Date().toISOString(),
      lineageKey: managed.state.lineageKey,
      generation: managed.state.generation,
      agentLabel: labelFor(managed.state.lineageKey, managed.state.generation),
      contractAddress: managed.state.contractAddress,
      txHash: recallTxHash,
      recallTxHash,
      failureReason: reason,
      ipfsCid: cid,
      inheritanceConstraints: draftPostMortem.inheritanceConstraints,
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
      logEvaluation(managed.state);
      await postEvaluationResultIfEnabled(managed.state);
      if (managed.state.consecutiveBelowThreshold >= 2) {
        await terminateAndRespawn(managed);
      }
    }
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
