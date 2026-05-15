import { encodePacked, keccak256 } from "viem";
import { getAaveYield, supplyToAave, withdrawFromAave } from "./aave.js";
import { buildAncestorContext } from "./lineage.js";
import { getMoeLPAPY, getMoeLPValue, addLiquidityToMoe, removeLiquidityFromMoe } from "./merchant-moe.js";
import { executeYieldReasoning, type VeniceDecision } from "./venice.js";
import type { ChildIPCReport, YieldAction } from "./types.js";

const USDE_ADDR = (process.env.USDE_ADDRESS ?? "") as `0x${string}`;
const USDC_ADDR = (process.env.USDC_ADDRESS ?? "") as `0x${string}`;

export type ChildRuntimeConfig = {
  lineageKey: string;
  generation: number;
  contractAddress: string;
  walletAddress: string;
  agentId: string;
  benchmarkYieldPct: number;
  cycleIntervalMs: number;
  spawnTxHash: string;
  privateKey?: `0x${string}`;
  dryRun: boolean;
  strategyProfile?: ChildStrategyProfile;
};

export type ChildStrategyProfile = {
  id: string;
  label: string;
  systemPrompt: string;
  targetAaveUSDeBps: number;
  targetCashBps: number;
  maxTradeBps: number;
  minimumSpreadBps: number;
  yieldBiasBps: {
    usde: number;
    meth: number;
    moe: number;
  };
  yieldNoiseBps: number;
  riskScoreModifier: number;
};

type ChildReportMessage = {
  type: "YIELD_REPORT";
  report: ChildIPCReport;
  cycleCount: number;
  actionTaken: YieldAction;
  rationale: string;
  decisionHash: `0x${string}`;
  decisionPayload: string;
  decisionPromptPrefix: string;
  decisionTimestamp: number;
  amountBps: number;
};

type ChildErrorMessage = {
  type: "ERROR";
  walletAddress: string;
  error: string;
  timestamp: number;
};

type PortfolioState = {
  cashReserve: number;
  aaveSupplyUSDE: number;
  aaveSupplyMETH: number;
  moeLPValue: number;
  peakYieldPct: number;
};

// Use the exact amount funded by parent — prevents Aave writes exceeding wallet balance.
const STARTING_USD = parseFloat(process.env.CHILD_SEED_USDE ?? "15");

const DEFAULT_STRATEGY_PROFILE: ChildStrategyProfile = {
  id: "balanced-carry",
  label: "Balanced Carry",
  systemPrompt:
    "Maintain a balanced USDe carry book: deploy most cash to Aave USDe, keep a small reserve, and avoid reallocating unless the adjusted APY spread is material.",
  targetAaveUSDeBps: 8_000,
  targetCashBps: 2_000,
  maxTradeBps: 8_000,
  minimumSpreadBps: 25,
  yieldBiasBps: {
    usde: 0,
    meth: -50,
    moe: -35,
  },
  yieldNoiseBps: 8,
  riskScoreModifier: 0,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function simulatedYield(base: number, cycleCount: number, seed: number, amplitude: number) {
  const wave = Math.sin((cycleCount + seed % 7) / 2.7) * amplitude;
  return Math.max(0.1, base + wave);
}

function normalizeBps(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return clampAmount(Math.round(value), 0, 10_000);
}

function getStrategyProfile(config: ChildRuntimeConfig): ChildStrategyProfile {
  const profile = config.strategyProfile;
  if (!profile) return DEFAULT_STRATEGY_PROFILE;

  return {
    ...DEFAULT_STRATEGY_PROFILE,
    ...profile,
    targetAaveUSDeBps: normalizeBps(profile.targetAaveUSDeBps, DEFAULT_STRATEGY_PROFILE.targetAaveUSDeBps),
    targetCashBps: normalizeBps(profile.targetCashBps, DEFAULT_STRATEGY_PROFILE.targetCashBps),
    maxTradeBps: normalizeBps(profile.maxTradeBps, DEFAULT_STRATEGY_PROFILE.maxTradeBps),
    minimumSpreadBps: normalizeBps(profile.minimumSpreadBps, DEFAULT_STRATEGY_PROFILE.minimumSpreadBps),
    yieldBiasBps: {
      ...DEFAULT_STRATEGY_PROFILE.yieldBiasBps,
      ...profile.yieldBiasBps,
    },
    yieldNoiseBps: Math.max(0, profile.yieldNoiseBps),
    riskScoreModifier: Number.isFinite(profile.riskScoreModifier)
      ? profile.riskScoreModifier
      : DEFAULT_STRATEGY_PROFILE.riskScoreModifier,
  };
}

function portfolioTotal(portfolio: PortfolioState) {
  return (
    portfolio.cashReserve +
    portfolio.aaveSupplyUSDE +
    portfolio.aaveSupplyMETH +
    portfolio.moeLPValue
  );
}

function targetAaveUSDeUSD(profile: ChildStrategyProfile, totalPortfolioUSD: number) {
  return (totalPortfolioUSD * profile.targetAaveUSDeBps) / 10_000;
}

function aaveUSDeDeployRoom(profile: ChildStrategyProfile, portfolio: PortfolioState) {
  const target = targetAaveUSDeUSD(profile, portfolioTotal(portfolio));
  return Math.max(0, target - portfolio.aaveSupplyUSDE);
}

function seededNoiseBps(seed: number, cycleCount: number, offset: number, amplitudeBps: number) {
  if (amplitudeBps <= 0) return 0;
  const staticComponent = ((hashSeed(`${seed}:${offset}`) % 2_001) / 1_000 - 1) * 0.45;
  const waveComponent = Math.sin((cycleCount + (seed % 17) + offset) / (3.1 + offset * 0.11)) * 0.55;
  return (staticComponent + waveComponent) * amplitudeBps;
}

function adjustedYield(
  rawYield: number,
  asset: "usde" | "meth" | "moe",
  profile: ChildStrategyProfile,
  cycleCount: number,
  seed: number
) {
  const offsets = { usde: 11, meth: 29, moe: 47 };
  const biasBps = profile.yieldBiasBps[asset] ?? 0;
  const noiseBps = seededNoiseBps(seed, cycleCount, offsets[asset], profile.yieldNoiseBps);
  return Math.max(0, rawYield + (biasBps + noiseBps) / 100);
}

function computeWeightedYield(portfolio: PortfolioState, yields: { usde: number; meth: number; moe: number }) {
  const deployed =
    portfolio.aaveSupplyUSDE + portfolio.aaveSupplyMETH + portfolio.moeLPValue;
  const total = deployed + portfolio.cashReserve;
  if (total <= 0) return 0;

  const weighted =
    portfolio.aaveSupplyUSDE * yields.usde +
    portfolio.aaveSupplyMETH * yields.meth +
    portfolio.moeLPValue * yields.moe;
  return weighted / total;
}

function clampAmount(amount: number, min = 0, max = Number.POSITIVE_INFINITY) {
  if (!Number.isFinite(amount)) return min;
  return Math.max(min, Math.min(max, amount));
}

async function safeGetAaveYield(
  asset: "USDE" | "METH",
  fallback: number
): Promise<number> {
  try {
    return await getAaveYield(asset);
  } catch {
    return fallback;
  }
}

async function runAction(
  config: ChildRuntimeConfig,
  portfolio: PortfolioState,
  action: YieldAction,
  amountUSD: number
): Promise<number> {
  const profile = getStrategyProfile(config);
  const liveWritesEnabled =
    process.env.ALLOW_LIVE_CHILD_WRITES === "true" &&
    !config.dryRun &&
    !!config.privateKey;

  switch (action) {
    case "AAVE_SUPPLY_USDE": {
      const amount = clampAmount(
        amountUSD,
        0,
        Math.min(portfolio.cashReserve, aaveUSDeDeployRoom(profile, portfolio))
      );
      if (amount <= 0) return 0;
      if (liveWritesEnabled) {
        await supplyToAave(config.privateKey!, "USDE", amount);
      }
      portfolio.cashReserve -= amount;
      portfolio.aaveSupplyUSDE += amount;
      return amount;
    }
    case "AAVE_SUPPLY_METH": {
      const amount = clampAmount(amountUSD, 0, portfolio.cashReserve);
      if (amount <= 0) return 0;
      if (liveWritesEnabled) {
        await supplyToAave(config.privateKey!, "METH", amount);
      }
      portfolio.cashReserve -= amount;
      portfolio.aaveSupplyMETH += amount;
      return amount;
    }
    case "AAVE_WITHDRAW_USDE": {
      const amount = clampAmount(amountUSD, 0, portfolio.aaveSupplyUSDE);
      if (amount <= 0) return 0;
      if (liveWritesEnabled) {
        await withdrawFromAave(config.privateKey!, "USDE", amount);
      }
      portfolio.aaveSupplyUSDE -= amount;
      portfolio.cashReserve += amount;
      return amount;
    }
    case "AAVE_WITHDRAW_METH": {
      const amount = clampAmount(amountUSD, 0, portfolio.aaveSupplyMETH);
      if (amount <= 0) return 0;
      if (liveWritesEnabled) {
        await withdrawFromAave(config.privateKey!, "METH", amount);
      }
      portfolio.aaveSupplyMETH -= amount;
      portfolio.cashReserve += amount;
      return amount;
    }
    case "MOE_ADD_LIQUIDITY": {
      const amount = clampAmount(amountUSD, 0, portfolio.cashReserve);
      if (amount <= 0) return 0;
      if (liveWritesEnabled) {
        if (!USDE_ADDR || !USDC_ADDR) throw new Error("USDE_ADDRESS and USDC_ADDRESS required for MOE_ADD_LIQUIDITY");
        // Split 50/50 between USDe (tokenX) and USDC (tokenY) — both ~$1
        const half = amount / 2;
        await addLiquidityToMoe(config.privateKey!, USDE_ADDR, USDC_ADDR, half, half);
      }
      portfolio.cashReserve -= amount;
      portfolio.moeLPValue += amount;
      return amount;
    }
    case "MOE_REMOVE_LIQUIDITY": {
      const amount = clampAmount(amountUSD, 0, portfolio.moeLPValue);
      if (amount <= 0) return 0;
      if (liveWritesEnabled) {
        if (!USDE_ADDR || !USDC_ADDR) throw new Error("USDE_ADDRESS and USDC_ADDRESS required for MOE_REMOVE_LIQUIDITY");
        const fraction = amount / portfolio.moeLPValue;
        await removeLiquidityFromMoe(config.privateKey!, USDE_ADDR, USDC_ADDR, fraction);
      }
      portfolio.moeLPValue -= amount;
      portfolio.cashReserve += amount;
      return amount;
    }
    case "REBALANCE": {
      const shift = clampAmount(amountUSD, 0, portfolio.aaveSupplyMETH);
      portfolio.aaveSupplyMETH -= shift;
      portfolio.aaveSupplyUSDE += shift;
      return shift;
    }
    case "HOLD":
    default:
      return 0;
  }
}

function decisionAmountBps(amountUSD: number, totalPortfolioUSD: number) {
  if (totalPortfolioUSD <= 0) return 0;
  return clampAmount(Math.round((amountUSD / totalPortfolioUSD) * 10_000), 0, 10_000);
}

function isScoredTrade(action: YieldAction) {
  return (
    action === "AAVE_SUPPLY_USDE" ||
    action === "AAVE_WITHDRAW_USDE" ||
    action === "MOE_ADD_LIQUIDITY" ||
    action === "REBALANCE"
  );
}

function applyStrategyAllocationGuard(
  config: ChildRuntimeConfig,
  portfolio: PortfolioState,
  decision: VeniceDecision,
  cycleCount: number
): VeniceDecision {
  const profile = getStrategyProfile(config);
  const total = portfolioTotal(portfolio);
  if (total <= 0 || cycleCount > 3) return decision;

  const deployRoom = aaveUSDeDeployRoom(profile, portfolio);
  if (portfolio.cashReserve <= 0.01 || deployRoom <= 0.01) return decision;

  const maxTradeUSD = Math.max(0, (total * profile.maxTradeBps) / 10_000);
  const profiledAmount = clampAmount(deployRoom, 0, Math.min(portfolio.cashReserve, maxTradeUSD));
  if (profiledAmount <= 0.01) return decision;

  if (decision.action === "HOLD" || decision.action === "AAVE_SUPPLY_USDE") {
    const requestedAmount =
      decision.action === "AAVE_SUPPLY_USDE" && decision.amountUSD > 0
        ? decision.amountUSD
        : profiledAmount;
    return {
      ...decision,
      action: "AAVE_SUPPLY_USDE",
      amountUSD: Math.min(requestedAmount, profiledAmount),
      asset: "USDe",
      rationale:
        decision.action === "HOLD"
          ? `${decision.rationale} Strategy allocation guard deployed toward ${profile.label}'s initial Aave USDe target.`
          : decision.rationale,
      riskNote:
        decision.riskNote ??
        `${profile.label} caps first allocation at ${(profile.targetAaveUSDeBps / 100).toFixed(2)}% Aave USDe.`,
    };
  }

  return decision;
}

function stdDev(values: number[]) {
  if (values.length <= 1) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export async function runChildProcess(config: ChildRuntimeConfig) {
  const seed = hashSeed(`${config.lineageKey}:${config.generation}:${config.walletAddress}`);
  const strategyProfile = getStrategyProfile(config);
  const portfolio: PortfolioState = {
    cashReserve: STARTING_USD,
    aaveSupplyUSDE: 0,
    aaveSupplyMETH: 0,
    moeLPValue: 0,
    peakYieldPct: config.benchmarkYieldPct,
  };

  const ancestorContext = await buildAncestorContext(config.lineageKey);
  const systemPrompt = [
    `You are Spawn Protocol child lineage ${config.lineageKey} generation ${config.generation} on Mantle mainnet.`,
    `Optimize for risk-adjusted yield above the benchmark of ${config.benchmarkYieldPct.toFixed(4)}%.`,
    `Strategy profile: ${strategyProfile.label}. ${strategyProfile.systemPrompt}`,
    `Target allocation: ${(strategyProfile.targetAaveUSDeBps / 100).toFixed(2)}% Aave USDe and ${(strategyProfile.targetCashBps / 100).toFixed(2)}% cash reserve. Do not exceed ${(strategyProfile.maxTradeBps / 100).toFixed(2)}% of portfolio in one trade, and require at least ${(strategyProfile.minimumSpreadBps / 100).toFixed(2)}% adjusted APY spread before reallocating deployed capital.`,
    `Market APYs are shown as raw live APY plus this profile's deterministic risk-perception adjustment. Treat the adjusted APY as your private decision view, and mention raw-live risk in riskNote when relevant.`,
    "You may use Aave USDe (Ethena synthetic dollar), Aave mETH, and Merchant Moe USDe/USDC LP (binStep=1). Merchant Moe writes are gated by ALLOW_LIVE_CHILD_WRITES and require both USDE_ADDRESS and USDC_ADDRESS.",
    ancestorContext,
  ].join("\n\n");

  console.log(`[Child:${config.lineageKey}-v${config.generation}] System prompt:\n${systemPrompt}`);

  let active = true;
  let cycleCount = 0;
  let numTradesLastEval = 0;
  const yieldWindow: number[] = [];

  const shutdown = () => {
    active = false;
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  while (active) {
    cycleCount += 1;

    try {
      const baseUSDE = config.benchmarkYieldPct + config.generation * 0.12;
      const baseMETH = 2.15 + config.generation * 0.08;
      const fallbackUSDE = simulatedYield(baseUSDE, cycleCount, seed, 0.32);
      const fallbackMETH = simulatedYield(baseMETH, cycleCount, seed + 17, 0.28);

      const rawAaveUSDEYield = await safeGetAaveYield("USDE", fallbackUSDE);
      const rawAaveMETHYield = await safeGetAaveYield("METH", fallbackMETH);
      const rawMoeLPYield = await getMoeLPAPY();
      const aaveUSDEYield = adjustedYield(rawAaveUSDEYield, "usde", strategyProfile, cycleCount, seed);
      const aaveMETHYield = adjustedYield(rawAaveMETHYield, "meth", strategyProfile, cycleCount, seed);
      const moeLPYield = adjustedYield(rawMoeLPYield, "moe", strategyProfile, cycleCount, seed);
      portfolio.moeLPValue = await getMoeLPValue(config.walletAddress);

      const totalPortfolioUSD = portfolioTotal(portfolio);

      const rawDecision = await executeYieldReasoning(systemPrompt, {
        aaveUSDEYield,
        aaveMETHYield,
        moeLPYield,
        rawAaveUSDEYield,
        rawAaveMETHYield,
        rawMoeLPYield,
        currentAaveUSDE: portfolio.aaveSupplyUSDE,
        currentAaveMETH: portfolio.aaveSupplyMETH,
        currentMoeLP: portfolio.moeLPValue,
        currentCashReserve: portfolio.cashReserve,
        totalPortfolioUSD,
        decisionProfile: {
          label: strategyProfile.label,
          targetAaveUSDeBps: strategyProfile.targetAaveUSDeBps,
          targetCashBps: strategyProfile.targetCashBps,
          maxTradeBps: strategyProfile.maxTradeBps,
          minimumSpreadBps: strategyProfile.minimumSpreadBps,
        },
      });
      const decision = applyStrategyAllocationGuard(config, portfolio, rawDecision, cycleCount);

      // activityScore is earned only from actual capital moves — HOLD gets 0.
      // Agents below benchmark that refuse to trade will score negative and face termination.
      numTradesLastEval = 0;
      const executedAmountUSD = await runAction(config, portfolio, decision.action, decision.amountUSD);
      const actionTaken: YieldAction = executedAmountUSD > 0 ? decision.action : "HOLD";
      if (executedAmountUSD > 0 && isScoredTrade(actionTaken)) {
        numTradesLastEval++;
      }
      const adjustedYieldPct = computeWeightedYield(portfolio, {
        usde: aaveUSDEYield,
        meth: aaveMETHYield,
        moe: moeLPYield,
      });
      const currentYieldPct = computeWeightedYield(portfolio, {
        usde: rawAaveUSDEYield,
        meth: rawAaveMETHYield,
        moe: rawMoeLPYield,
      });
      const decisionTimestamp = Date.now();
      const decisionPayload = JSON.stringify({
        ...decision,
        actionTaken,
        executedAmountUSD,
        strategyProfile: strategyProfile.id,
        portfolioYields: {
          rawMarketYieldPct: currentYieldPct,
          adjustedYieldPct,
        },
        adjustedYields: {
          aaveUSDEYield,
          aaveMETHYield,
          moeLPYield,
        },
        rawYields: {
          rawAaveUSDEYield,
          rawAaveMETHYield,
          rawMoeLPYield,
        },
      });
      const decisionPromptPrefix = systemPrompt.slice(0, 200);
      const decisionHash = keccak256(
        encodePacked(
          ["string", "string", "uint256"],
          [decisionPromptPrefix, decisionPayload, BigInt(decisionTimestamp)]
        )
      );
      const amountBps = decisionAmountBps(executedAmountUSD, totalPortfolioUSD);

      portfolio.peakYieldPct = Math.max(portfolio.peakYieldPct, currentYieldPct);
      const drawdownPct = Math.max(0, portfolio.peakYieldPct - currentYieldPct);
      yieldWindow.push(adjustedYieldPct);
      if (yieldWindow.length > 5) {
        yieldWindow.shift();
      }

      const report: ChildIPCReport = {
        type: "YIELD_REPORT",
        walletAddress: config.walletAddress,
        currentYieldPct,
        adjustedYieldPct,
        drawdownPct,
        positionSummary:
          `cash=$${portfolio.cashReserve.toFixed(2)}, ` +
          `aaveUSDE=$${portfolio.aaveSupplyUSDE.toFixed(2)}, ` +
          `aaveMETH=$${portfolio.aaveSupplyMETH.toFixed(2)}, ` +
          `moeLP=$${portfolio.moeLPValue.toFixed(2)}, ` +
          `profile=${strategyProfile.id}, ` +
          `rawUSDE=${rawAaveUSDEYield.toFixed(4)}%, ` +
          `adjustedUSDE=${aaveUSDEYield.toFixed(4)}%, ` +
          `adjustedYield=${adjustedYieldPct.toFixed(4)}%, ` +
          `action=${actionTaken}`,
        aaveSupplyUSDE: portfolio.aaveSupplyUSDE,
        aaveSupplyMETH: portfolio.aaveSupplyMETH,
        moeLPValue: portfolio.moeLPValue,
        timestamp: Date.now(),
        numTradesLastEval,
        stdDevYieldLastEval: stdDev(yieldWindow),
        riskProfileModifier: strategyProfile.riskScoreModifier,
      };

      const message: ChildReportMessage = {
        type: "YIELD_REPORT",
        report,
        cycleCount,
        actionTaken,
        rationale: decision.rationale,
        decisionHash,
        decisionPayload,
        decisionPromptPrefix,
        decisionTimestamp,
        amountBps,
      };

      if (process.send) {
        process.send(message);
      } else {
        console.log(`[Child:${config.lineageKey}-v${config.generation}]`, message);
      }
      numTradesLastEval = 0;
    } catch (error: any) {
      const message: ChildErrorMessage = {
        type: "ERROR",
        walletAddress: config.walletAddress,
        error: error?.message ?? String(error),
        timestamp: Date.now(),
      };

      if (process.send) {
        process.send(message);
      } else {
        console.error(`[Child:${config.lineageKey}-v${config.generation}]`, message.error);
      }
    }

    if (!active) break;
    await sleep(config.cycleIntervalMs);
  }
}

export function parseChildConfig(raw?: string): ChildRuntimeConfig {
  if (!raw) {
    throw new Error("CHILD_CONFIG is required");
  }
  const config = JSON.parse(raw) as ChildRuntimeConfig;

  const childPrivateKey = process.env.CHILD_PRIVATE_KEY;
  if (childPrivateKey) {
    config.privateKey = (childPrivateKey.startsWith("0x") ? childPrivateKey : `0x${childPrivateKey}`) as `0x${string}`;
  }
  if (process.env.CHILD_WALLET_ADDRESS?.startsWith("0x")) {
    config.walletAddress = process.env.CHILD_WALLET_ADDRESS;
  }
  if (process.env.CHILD_CONTRACT_ADDRESS?.startsWith("0x")) {
    config.contractAddress = process.env.CHILD_CONTRACT_ADDRESS;
  }
  if (process.env.ALLOW_LIVE_CHILD_WRITES === "true" && !config.dryRun && !config.privateKey) {
    throw new Error("CHILD_PRIVATE_KEY is required for live child writes");
  }

  return config;
}

export async function startChildFromEnv() {
  const config = parseChildConfig(process.env.CHILD_CONFIG);
  await runChildProcess(config);
}

if (import.meta.url === `file://${process.argv[1]}` && process.env.CHILD_CONFIG) {
  startChildFromEnv().catch((error) => {
    console.error("[Child] Fatal:", error);
    process.exitCode = 1;
  });
}
