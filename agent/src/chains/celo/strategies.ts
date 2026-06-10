/**
 * Strategy engine (Phase 4) — the CLAUDE.md §3.2 interface, deterministic
 * by design (Phase 0 decision 3): evaluate(ctx, portfolio, params) returns
 * intents, not raw txs, and every intent carries the human-readable reason
 * derived from the rule that fired. No LLM in the decision path — every
 * decision is recomputable from the same onchain inputs.
 */

import { parseUnits, formatUnits } from "viem";
import { TOKENS, TOKEN_DECIMALS } from "./addresses.js";
import type { AaveAsset } from "./aave.js";
import { AAVE_CHOICES, FX_LEGS, type FxLeg, type MarketContext } from "./market.js";
import type { Portfolio } from "./portfolio.js";
import type { AgentSpec, StrategyId } from "./agents-config.js";

export type Action =
  | {
      kind: "mento-swap";
      tokenIn: keyof typeof TOKENS;
      tokenOut: keyof typeof TOKENS;
      amountIn: bigint;
      usdValue: number;
      reason: string;
    }
  | { kind: "aave-supply"; asset: AaveAsset; amount: bigint; usdValue: number; reason: string }
  | { kind: "aave-withdraw"; asset: AaveAsset; amount: bigint | "max"; usdValue: number; reason: string }
  | { kind: "hold"; reason: string };

export interface Strategy {
  id: StrategyId;
  describe(params: Record<string, number | boolean>): string;
  evaluate(ctx: MarketContext, pf: Portfolio, params: Record<string, number | boolean>): Action[];
}

const MIN_ACTION_USD = 0.25; // don't emit dust actions

function fxUnits(pf: Portfolio, leg: FxLeg, ctx: MarketContext): number {
  return Number(formatUnits(pf.wallet[leg] ?? 0n, 18)) * ctx.fxUsdPrice[leg];
}

/** Best FX leg by momentum net of round-trip cost; null if none clears the bar. */
function bestFxLeg(ctx: MarketContext, minEdgeBps: number): FxLeg | null {
  let best: FxLeg | null = null;
  let bestNet = 0;
  for (const leg of FX_LEGS) {
    const net = ctx.fxMomentumBps[leg] - ctx.fxRoundTripCostBps[leg] - minEdgeBps;
    if (net > bestNet) {
      bestNet = net;
      best = leg;
    }
  }
  return best;
}

function bestAaveAsset(ctx: MarketContext): AaveAsset {
  return AAVE_CHOICES.reduce((a, b) => (ctx.aaveApyPct[a] >= ctx.aaveApyPct[b] ? a : b));
}

// ---------------------------------------------------------------------------
export const MentoFXRotator: Strategy = {
  id: "MentoFXRotator",
  describe: (p) =>
    `Rotate cUSD/cEUR/cREAL via Mento when FX momentum beats round-trip cost + ${p.minEdgeBps}bps`,
  evaluate(ctx, pf, params) {
    const minEdge = Number(params.minEdgeBps);
    const actions: Action[] = [];

    // exit legs whose momentum decayed below the negative bar
    for (const leg of FX_LEGS) {
      const usd = fxUnits(pf, leg, ctx);
      if (usd < MIN_ACTION_USD) continue;
      const net = ctx.fxMomentumBps[leg] + ctx.fxRoundTripCostBps[leg];
      if (net < -minEdge) {
        actions.push({
          kind: "mento-swap",
          tokenIn: leg,
          tokenOut: "USDm",
          amountIn: pf.wallet[leg] ?? 0n,
          usdValue: usd,
          reason: `${leg} momentum ${ctx.fxMomentumBps[leg].toFixed(1)}bps over the last epoch is below -(edge ${minEdge}bps), exiting to cUSD to protect purchasing power`,
        });
      }
    }

    // enter the best leg with idle cUSD if its edge clears the bar
    const target = bestFxLeg(ctx, minEdge);
    const idleUsd = Number(formatUnits(pf.wallet.USDm ?? 0n, 18));
    if (target && idleUsd >= MIN_ACTION_USD && fxUnits(pf, target, ctx) < MIN_ACTION_USD) {
      actions.push({
        kind: "mento-swap",
        tokenIn: "USDm",
        tokenOut: target,
        amountIn: pf.wallet.USDm ?? 0n,
        usdValue: idleUsd,
        reason: `${target} momentum ${ctx.fxMomentumBps[target].toFixed(1)}bps exceeds round-trip cost ${ctx.fxRoundTripCostBps[target].toFixed(1)}bps + edge ${minEdge}bps, rotating cUSD in`,
      });
    }

    if (actions.length === 0) {
      actions.push({
        kind: "hold",
        reason: `no FX leg clears momentum > cost + ${minEdge}bps (EURm ${ctx.fxMomentumBps.EURm.toFixed(1)}bps/cost ${ctx.fxRoundTripCostBps.EURm.toFixed(1)}bps, BRLm ${ctx.fxMomentumBps.BRLm.toFixed(1)}bps/cost ${ctx.fxRoundTripCostBps.BRLm.toFixed(1)}bps); holding`,
      });
    }
    return actions;
  },
};

// ---------------------------------------------------------------------------
export const AaveYielder: Strategy = {
  id: "AaveYielder",
  describe: (p) =>
    `Supply stables to Aave v3, compound, rebalance when APY delta > ${p.minApyDeltaBps}bps; ${Number(p.reserveBps) / 100}% reserve`,
  evaluate(ctx, pf, params) {
    const minDeltaBps = Number(params.minApyDeltaBps);
    const reserveBps = Number(params.reserveBps);
    const actions: Action[] = [];

    const best = bestAaveAsset(ctx);
    const positions = (Object.entries(pf.aave) as [AaveAsset, bigint][]).filter(
      ([a, bal]) => Number(formatUnits(bal, TOKEN_DECIMALS[a])) >= MIN_ACTION_USD,
    );
    const current = positions.sort((x, y) =>
      Number(formatUnits(y[1], TOKEN_DECIMALS[y[0]])) - Number(formatUnits(x[1], TOKEN_DECIMALS[x[0]])),
    )[0]?.[0];

    if (current && current !== best) {
      const deltaBps = (ctx.aaveApyPct[best] - ctx.aaveApyPct[current]) * 100;
      if (deltaBps >= minDeltaBps) {
        const posUsd = Number(formatUnits(pf.aave[current] ?? 0n, TOKEN_DECIMALS[current]));
        actions.push({
          kind: "aave-withdraw",
          asset: current,
          amount: "max",
          usdValue: posUsd,
          reason: `${best} supply APY ${ctx.aaveApyPct[best].toFixed(2)}% beats ${current} ${ctx.aaveApyPct[current].toFixed(2)}% by ${deltaBps.toFixed(0)}bps ≥ ${minDeltaBps}bps threshold, rotating`,
        });
        actions.push({
          kind: "mento-swap",
          tokenIn: current,
          tokenOut: best,
          amountIn: -1n, // resolved by executor to post-withdraw balance
          usdValue: posUsd,
          reason: `convert withdrawn ${current} to ${best} for the higher-APY supply`,
        });
        actions.push({
          kind: "aave-supply",
          asset: best,
          amount: -1n, // resolved to post-swap balance minus reserve
          usdValue: posUsd,
          reason: `supply rotated funds at ${ctx.aaveApyPct[best].toFixed(2)}% APY`,
        });
        return actions;
      }
    }

    // compound idle balance above the reserve into the target asset
    const target = current ?? best;
    const idle = pf.wallet[target] ?? 0n;
    const totalUsd = pf.totalUsd;
    const reserveUsd = (totalUsd * reserveBps) / 10_000;
    const idleUsd = Number(formatUnits(idle, TOKEN_DECIMALS[target]));
    if (idleUsd - reserveUsd >= MIN_ACTION_USD) {
      const deployUsd = idleUsd - reserveUsd;
      const deployUnits = parseUnits(deployUsd.toFixed(TOKEN_DECIMALS[target]), TOKEN_DECIMALS[target]);
      actions.push({
        kind: "aave-supply",
        asset: target,
        amount: deployUnits,
        usdValue: deployUsd,
        reason: `deploy idle ${target} above the ${reserveBps / 100}% reserve into Aave at ${ctx.aaveApyPct[target].toFixed(2)}% APY`,
      });
    } else if (target !== "USDm" && Number(formatUnits(pf.wallet.USDm ?? 0n, 18)) - reserveUsd >= MIN_ACTION_USD) {
      // funded in cUSD but target asset pays more: convert then supply next epoch
      const usdmIdle = Number(formatUnits(pf.wallet.USDm ?? 0n, 18)) - reserveUsd;
      actions.push({
        kind: "mento-swap",
        tokenIn: "USDm",
        tokenOut: target,
        amountIn: parseUnits(usdmIdle.toFixed(18), 18),
        usdValue: usdmIdle,
        reason: `convert idle cUSD to ${target} (best supply APY ${ctx.aaveApyPct[target].toFixed(2)}%) ahead of supplying`,
      });
    }

    if (actions.length === 0) {
      actions.push({
        kind: "hold",
        reason: `position already in ${target} at ${ctx.aaveApyPct[target].toFixed(2)}% APY; no APY gap ≥ ${minDeltaBps}bps and no idle balance above reserve`,
      });
    }
    return actions;
  },
};

// ---------------------------------------------------------------------------
export const HedgedCarry: Strategy = {
  id: "HedgedCarry",
  describe: (p) =>
    `${(10_000 - Number(p.fxLegBps)) / 100}% Aave yield + ${Number(p.fxLegBps) / 100}% strongest Mento FX leg`,
  evaluate(ctx, pf, params) {
    const fxBps = Number(params.fxLegBps);
    const minEdge = Number(params.minEdgeBps);
    const actions: Action[] = [];

    const fxTargetUsd = (pf.totalUsd * fxBps) / 10_000;
    const leg = bestFxLeg(ctx, minEdge);
    const fxHeldUsd = FX_LEGS.reduce((s, l) => s + fxUnits(pf, l, ctx), 0);

    // FX leg management
    if (leg && fxHeldUsd < fxTargetUsd - MIN_ACTION_USD) {
      const buyUsd = Math.min(
        fxTargetUsd - fxHeldUsd,
        Number(formatUnits(pf.wallet.USDm ?? 0n, 18)),
      );
      if (buyUsd >= MIN_ACTION_USD) {
        actions.push({
          kind: "mento-swap",
          tokenIn: "USDm",
          tokenOut: leg,
          amountIn: parseUnits(buyUsd.toFixed(18), 18),
          usdValue: buyUsd,
          reason: `hedge leg under target (${fxHeldUsd.toFixed(2)} < ${fxTargetUsd.toFixed(2)} USD): buy ${leg}, momentum ${ctx.fxMomentumBps[leg].toFixed(1)}bps clears cost + ${minEdge}bps`,
        });
      }
    } else if (!leg && fxHeldUsd >= MIN_ACTION_USD) {
      // no leg clears the bar: de-risk hedge back to cUSD
      for (const l of FX_LEGS) {
        const usd = fxUnits(pf, l, ctx);
        if (usd < MIN_ACTION_USD) continue;
        actions.push({
          kind: "mento-swap",
          tokenIn: l,
          tokenOut: "USDm",
          amountIn: pf.wallet[l] ?? 0n,
          usdValue: usd,
          reason: `no FX leg clears momentum > cost + ${minEdge}bps this epoch; de-risking ${l} hedge back to cUSD`,
        });
      }
    }

    // carry side: idle cUSD above what the FX target needs goes to best Aave
    const best = bestAaveAsset(ctx);
    const idleUsd = Number(formatUnits(pf.wallet.USDm ?? 0n, 18));
    const fxShortfall = leg ? Math.max(0, fxTargetUsd - fxHeldUsd) : 0;
    const carryUsd = idleUsd - fxShortfall;
    if (carryUsd >= MIN_ACTION_USD) {
      if (best === "USDm") {
        actions.push({
          kind: "aave-supply",
          asset: "USDm",
          amount: parseUnits(carryUsd.toFixed(18), 18),
          usdValue: carryUsd,
          reason: `carry side: supply idle cUSD to Aave at ${ctx.aaveApyPct.USDm.toFixed(2)}% APY (best stable rate)`,
        });
      } else {
        actions.push({
          kind: "mento-swap",
          tokenIn: "USDm",
          tokenOut: best,
          amountIn: parseUnits(carryUsd.toFixed(18), 18),
          usdValue: carryUsd,
          reason: `carry side: convert idle cUSD to ${best} (best supply APY ${ctx.aaveApyPct[best].toFixed(2)}%)`,
        });
        actions.push({
          kind: "aave-supply",
          asset: best,
          amount: -1n, // post-swap balance
          usdValue: carryUsd,
          reason: `carry side: supply ${best} at ${ctx.aaveApyPct[best].toFixed(2)}% APY`,
        });
      }
    }

    if (actions.length === 0) {
      actions.push({
        kind: "hold",
        reason: `allocation at target (${(fxBps / 100).toFixed(0)}% FX hedge / carry in Aave); no edge or drift worth paying swap cost for`,
      });
    }
    return actions;
  },
};

export const STRATEGIES: Record<StrategyId, Strategy> = {
  MentoFXRotator,
  AaveYielder,
  HedgedCarry,
};

export function strategyFor(spec: AgentSpec): Strategy {
  return STRATEGIES[spec.strategy];
}
