import type { ChildState, TerminationPostMortem, YieldAction } from "./types.js";

const VENICE_API = "https://api.venice.ai/api/v1/chat/completions";
const VENICE_MODEL = "llama-3.3-70b";

// Venice Privacy: All API calls use Venice's zero-data-retention policy.
// No conversation data is stored server-side by Venice.
// include_venice_system_prompt: false ensures Venice's default assistant
// prompts do not prepend to the carefully crafted yield/postmortem prompts.
// Note: the old E2EE request flag is NOT a valid API parameter (it was removed).
// E2EE is a model-level feature selected by model ID, not a request flag.

export function parseVeniceJSON<T>(raw: string): T {
  const clean = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(clean) as T;
}

type MarketState = {
  aaveUSDEYield: number;
  aaveMETHYield: number;
  moeLPYield: number;
  rawAaveUSDEYield?: number;
  rawAaveMETHYield?: number;
  rawMoeLPYield?: number;
  currentAaveUSDE: number;
  currentAaveMETH: number;
  currentMoeLP: number;
  currentCashReserve: number;
  totalPortfolioUSD: number;
  decisionProfile?: {
    label: string;
    targetAaveUSDeBps: number;
    targetCashBps: number;
    maxTradeBps: number;
    minimumSpreadBps: number;
  };
};

export type VeniceDecision = {
  action: YieldAction;
  amountUSD: number;
  asset: string;
  rationale: string;
  riskNote?: string;
};

function clampAmount(amount: number, min = 0, max = Number.POSITIVE_INFINITY) {
  if (!Number.isFinite(amount)) return min;
  return Math.max(min, Math.min(max, amount));
}

function fallbackDecision(marketState: MarketState): VeniceDecision {
  const candidates = [
    { action: "AAVE_SUPPLY_USDE" as const, asset: "USDe", apy: marketState.aaveUSDEYield },
    { action: "AAVE_SUPPLY_METH" as const, asset: "mETH", apy: marketState.aaveMETHYield },
    { action: "MOE_ADD_LIQUIDITY" as const, asset: "USDe", apy: marketState.moeLPYield },
  ].sort((a, b) => b.apy - a.apy);

  const best = candidates[0];
  if (!best || best.apy <= 0) {
    return {
      action: "HOLD",
      amountUSD: 0,
      asset: "USDe",
      rationale: "No positive yield surface is available, so capital stays idle in dry-run fallback mode.",
      riskNote: "Missing live Mantle market inputs.",
    };
  }

  const profile = marketState.decisionProfile;
  const availableCash = clampAmount(
    marketState.currentCashReserve,
    0,
    marketState.totalPortfolioUSD
  );
  const maxTradeUSD = profile
    ? (marketState.totalPortfolioUSD * profile.maxTradeBps) / 10_000
    : availableCash;

  if (availableCash <= 0.01 || maxTradeUSD <= 0.01) {
    return {
      action: "HOLD",
      amountUSD: 0,
      asset: best.asset,
      rationale: "Fallback reasoning found no deployable cash inside the active strategy profile.",
      riskNote: profile
        ? `${profile.label} is already at or beyond its target deployable allocation.`
        : "No cash is available for a new position.",
    };
  }

  if (best.action === "AAVE_SUPPLY_USDE") {
    const targetAaveUSDe = profile
      ? (marketState.totalPortfolioUSD * profile.targetAaveUSDeBps) / 10_000
      : marketState.totalPortfolioUSD;
    const deployRoom = Math.max(0, targetAaveUSDe - marketState.currentAaveUSDE);
    const amountUSD = clampAmount(deployRoom, 0, Math.min(availableCash, maxTradeUSD));

    if (amountUSD <= 0.01) {
      return {
        action: "HOLD",
        amountUSD: 0,
        asset: best.asset,
        rationale: "Fallback reasoning held because the strategy's Aave USDe target is already filled.",
        riskNote: profile
          ? `${profile.label} target Aave USDe allocation is filled.`
          : "Aave USDe allocation is filled.",
      };
    }

    return {
      action: best.action,
      amountUSD,
      asset: best.asset,
      rationale: `Fallback routing selected ${profile?.label ?? "default"} Aave USDe carry up to its target allocation at ${best.apy.toFixed(4)}% adjusted APY.`,
      riskNote: "Decision generated without Venice due to missing or failing API access.",
    };
  }

  const amountUSD = clampAmount(availableCash, 0, maxTradeUSD);
  if (amountUSD <= 0.01) {
    return {
      action: "HOLD",
      amountUSD: 0,
      asset: best.asset,
      rationale: "Fallback reasoning held because the profile trade cap leaves no executable amount.",
      riskNote: "No executable cash amount after profile limits.",
    };
  }

  return {
    action: best.action,
    amountUSD,
    asset: best.asset,
    rationale: `Fallback routing selected the highest profile-adjusted APY path at ${best.apy.toFixed(4)}%.`,
    riskNote: "Decision generated without Venice due to missing or failing API access.",
  };
}

async function callVenice(systemPrompt: string, userPrompt: string): Promise<string | null> {
  if (!process.env.VENICE_API_KEY) return null;

  try {
    const response = await fetch(VENICE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.VENICE_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.VENICE_MODEL ?? VENICE_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        venice_parameters: {
          include_venice_system_prompt: false,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Venice HTTP ${response.status}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch (error: any) {
    console.warn(`[Venice] Falling back to deterministic reasoning: ${error?.message ?? String(error)}`);
    return null;
  }
}

export async function executeYieldReasoning(
  systemPrompt: string,
  marketState: MarketState
): Promise<VeniceDecision> {
  const fallback = fallbackDecision(marketState);
  const profile = marketState.decisionProfile;
  const profileBlock = profile
    ? `\nStrategy profile: ${profile.label}
Target Aave USDe allocation: ${(profile.targetAaveUSDeBps / 100).toFixed(2)}%
Target cash reserve: ${(profile.targetCashBps / 100).toFixed(2)}%
Maximum single trade: ${(profile.maxTradeBps / 100).toFixed(2)}%
Minimum rebalance spread: ${(profile.minimumSpreadBps / 100).toFixed(2)}%`
    : "";
  const rawYieldBlock = marketState.rawAaveUSDEYield !== undefined
    ? `\nRaw live APYs:
Aave USDe APY: ${marketState.rawAaveUSDEYield.toFixed(4)}%
Aave mETH APY: ${(marketState.rawAaveMETHYield ?? marketState.aaveMETHYield).toFixed(4)}%
Merchant Moe LP APY: ${(marketState.rawMoeLPYield ?? marketState.moeLPYield).toFixed(4)}%

Profile-adjusted APYs for this agent's decision:
Aave USDe adjusted APY: ${marketState.aaveUSDEYield.toFixed(4)}%
Aave mETH adjusted APY: ${marketState.aaveMETHYield.toFixed(4)}%
Merchant Moe LP adjusted APY: ${marketState.moeLPYield.toFixed(4)}%`
    : `\nAave USDe APY: ${marketState.aaveUSDEYield.toFixed(4)}%
Aave mETH APY: ${marketState.aaveMETHYield.toFixed(4)}%
Merchant Moe LP APY: ${marketState.moeLPYield.toFixed(4)}%`;
  const content = await callVenice(
    systemPrompt,
    `Current Mantle yield surface:${profileBlock}${rawYieldBlock}
Aave USDe position: $${marketState.currentAaveUSDE.toFixed(2)}
Aave mETH position: $${marketState.currentAaveMETH.toFixed(2)}
Merchant Moe LP position: $${marketState.currentMoeLP.toFixed(2)}
Cash reserve: $${marketState.currentCashReserve.toFixed(2)}
Total portfolio: $${marketState.totalPortfolioUSD.toFixed(2)}

Respond only with valid JSON:
{
  "action": "AAVE_SUPPLY_USDE|AAVE_SUPPLY_METH|AAVE_WITHDRAW_USDE|AAVE_WITHDRAW_METH|MOE_ADD_LIQUIDITY|MOE_REMOVE_LIQUIDITY|REBALANCE|HOLD",
  "amountUSD": <number>,
  "asset": "USDe|mETH",
  "rationale": "<private reasoning>",
  "riskNote": "<main risk>"
}`
  );

  if (!content) return fallback;

  try {
    const parsed = parseVeniceJSON<VeniceDecision>(content);
    return {
      action: parsed.action,
      amountUSD: Number.isFinite(parsed.amountUSD) ? parsed.amountUSD : fallback.amountUSD,
      asset: parsed.asset || fallback.asset,
      rationale: parsed.rationale || fallback.rationale,
      riskNote: parsed.riskNote || fallback.riskNote,
    };
  } catch (error: any) {
    console.warn(`[Venice] Invalid JSON payload, using fallback: ${error?.message ?? String(error)}`);
    return fallback;
  }
}

export async function generatePostMortem(
  state: ChildState
): Promise<Omit<TerminationPostMortem, "mantleRecallTxHash">> {
  const fallback = {
    failureReason: "Risk-adjusted yield stayed below the required threshold for two consecutive evaluations.",
    positionSummary: state.positionSummary,
    inheritanceConstraints: [
      "Avoid concentrating capital in the lowest recent APY leg.",
      "Reduce drawdown exposure before adding fresh size.",
      "Prefer stable positive carry over reactive churn.",
    ],
  };

  const content = await callVenice(
    "You are generating a terse failure post-mortem for a Mantle yield agent lineage.",
    `Generate a termination post-mortem for this child agent and respond only with valid JSON:
{
  "failureReason": "<specific technical reason>",
  "positionSummary": "<positions held at termination>",
  "inheritanceConstraints": ["<constraint 1>", "<constraint 2>", "<constraint 3>"]
}

lineageKey=${state.lineageKey}
generation=${state.generation}
cyclesLived=${state.cycleCount}
currentYieldPct=${state.currentYieldPct}
benchmarkYieldPct=${state.benchmarkYieldPct}
maxDrawdownPct=${state.maxDrawdownPct}
riskAdjustedScore=${state.riskAdjustedScore}
positionSummary=${state.positionSummary}`
  );

  let parsed = fallback;
  if (content) {
    try {
      const result = parseVeniceJSON<typeof fallback>(content);
      parsed = {
        failureReason: result.failureReason || fallback.failureReason,
        positionSummary: result.positionSummary || fallback.positionSummary,
        inheritanceConstraints:
          Array.isArray(result.inheritanceConstraints) && result.inheritanceConstraints.length > 0
            ? result.inheritanceConstraints
            : fallback.inheritanceConstraints,
      };
    } catch (error: any) {
      console.warn(`[Venice] Post-mortem parse failed, using fallback: ${error?.message ?? String(error)}`);
    }
  }

  return {
    lineageKey: state.lineageKey,
    generation: state.generation,
    agentContractAddress: state.contractAddress,
    agentWalletAddress: state.walletAddress,
    terminationTimestamp: Date.now(),
    cyclesLived: state.cycleCount,
    failureReason: parsed.failureReason,
    metricsAtTermination: {
      finalYieldPct: state.currentYieldPct,
      benchmarkYieldPct: state.benchmarkYieldPct,
      maxDrawdownPct: state.maxDrawdownPct,
      riskAdjustedScore: state.riskAdjustedScore,
      positionSummary: parsed.positionSummary,
    },
    inheritanceConstraints: parsed.inheritanceConstraints,
  };
}

export async function testVeniceConnection(): Promise<{ ok: boolean; model: string; responsePreview: string }> {
  const model = process.env.VENICE_MODEL ?? VENICE_MODEL;
  const content = await callVenice(
    "You are a connection test for Spawn Protocol.",
    "Respond with exactly: OK"
  );
  if (!content) {
    return { ok: false, model, responsePreview: "(no response — check VENICE_API_KEY)" };
  }
  return { ok: true, model, responsePreview: content.slice(0, 80) };
}

export async function generateGenerationSummary(state: ChildState): Promise<string> {
  const fallback =
    `Gen ${state.generation} ${state.lineageKey}: yield ${state.currentYieldPct.toFixed(4)}% vs ` +
    `benchmark ${state.benchmarkYieldPct.toFixed(4)}%, drawdown ${state.maxDrawdownPct.toFixed(4)}%, ` +
    `risk score ${state.riskAdjustedScore.toFixed(4)}.`;

  const content = await callVenice(
    "You summarize Mantle yield-agent performance for an on-chain event. Be concrete and terse.",
    `Write one concise summary for this evaluation. Do not use markdown. Maximum 240 characters.

lineageKey=${state.lineageKey}
generation=${state.generation}
cycles=${state.cycleCount}
currentYieldPct=${state.currentYieldPct}
benchmarkYieldPct=${state.benchmarkYieldPct}
maxDrawdownPct=${state.maxDrawdownPct}
riskAdjustedScore=${state.riskAdjustedScore}
consecutiveBelowThreshold=${state.consecutiveBelowThreshold}
positionSummary=${state.positionSummary}`
  );

  const summary = (content || fallback).replace(/\s+/g, " ").trim();
  return summary.length > 280 ? `${summary.slice(0, 277)}...` : summary;
}
