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
import { AAVE_CHOICES, FX_LEGS, type FxLeg, type StableLeg, type MarketContext } from "./market.js";
import { MAX_TX_USD } from "./budget.js";
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

// ---------------------------------------------------------------------------
// MentoCarryArb — Mento-ONLY stable carry/arb across cUSD/USDC/USDT.
//
// Monitors the cUSD/USDC and cUSD/USDT round-trip spreads via Mento broker
// quotes (no Uniswap, no new protocols) and rotates the book into whichever
// USD stable has a positive net carry edge:
//
//   netEdgeBps = carryBps + spreadBps − roundTripCostBps − gasBps
//
//   carryBps        = (aaveApy[target] − aaveApy[current]) · 100   [APY % → bps]
//                     · (CARRY_HOLD_HOURS / 8760)                  [annualized →
//                       expected-hold equivalent]
//   spreadBps       = one-way quote misalignment vs 1:1 parity actually
//                     captured on the legs executed (exit edge of the current
//                     stable + entry edge of the target, from the snapshot's
//                     $1 probes)
//   roundTripCostBps= full Mento round-trip cost of every non-cUSD pair
//                     touched — charged in full up front (conservative: the
//                     one-way cost is also inside spreadBps, so the bar to
//                     act is deliberately high)
//   gasBps          = EST_GAS_USD_PER_TX · (#swaps + 1 supply) / moveUsd · 1e4
//
// Acts only when netEdgeBps > genome minEdgeBps; otherwise holds with the
// observed numbers in the rationale. Every input is recomputable from the
// same public broker quotes and Aave reads a judge can fetch.

/** Assets the carry book may sit in (all Aave-suppliable USD stables). */
const CARRY_ASSETS: AaveAsset[] = ["USDm", "USDC", "USDT"];
/**
 * Expected holding horizon used to convert the annualized APY advantage into
 * the bps actually earned before the position is expected to rotate again.
 * 168h = 1 week = 42 four-hour epochs. A pure single-epoch (4h) equivalent
 * would make the carry term < 0.1bps and the strategy would never act on
 * yield, only on misalignment.
 */
const CARRY_HOLD_HOURS = 168;
const HOURS_PER_YEAR = 8760;
/**
 * Per-transaction gas estimate in USD (CIP-64 cUSD gas). Observed swarm
 * epochs spend $0.003–0.008 across several txs (see swarm-state history),
 * so $0.002/tx is the right order of magnitude.
 */
const EST_GAS_USD_PER_TX = 0.002;

/** wallet + Aave holdings of a carry asset, marked 1:1 in USD. */
function carryUsd(pf: Portfolio, asset: AaveAsset): number {
  const dec = TOKEN_DECIMALS[asset];
  return (
    Number(formatUnits(pf.wallet[asset] ?? 0n, dec)) +
    Number(formatUnits(pf.aave[asset] ?? 0n, dec))
  );
}

export type CarryEdge = {
  netBps: number;
  apyDeltaBps: number;
  carryBps: number;
  spreadBps: number;
  rtCostBps: number;
  gasBps: number;
  txEst: number;
};

/** Pure edge computation for moving `moveUsd` from `current` to `target`. */
export function carryMoveEdgeBps(
  ctx: MarketContext,
  current: AaveAsset,
  target: AaveAsset,
  moveUsd: number,
): CarryEdge {
  const apyDeltaBps = (ctx.aaveApyPct[target] - ctx.aaveApyPct[current]) * 100;
  const carryBps = apyDeltaBps * (CARRY_HOLD_HOURS / HOURS_PER_YEAR);
  const exitBps = current === "USDm" ? 0 : ctx.stableExitEdgeBps[current as StableLeg];
  const entryBps = target === "USDm" ? 0 : ctx.stableEntryEdgeBps[target as StableLeg];
  const spreadBps = exitBps + entryBps;
  const rtCostBps =
    (current === "USDm" ? 0 : ctx.stableRoundTripCostBps[current as StableLeg]) +
    (target === "USDm" ? 0 : ctx.stableRoundTripCostBps[target as StableLeg]);
  const nSwaps = (current === "USDm" ? 0 : 1) + (target === "USDm" ? 0 : 1);
  const txEst = nSwaps + 1; // + the Aave supply on the target side
  const gasBps =
    moveUsd > 0 ? ((EST_GAS_USD_PER_TX * txEst) / moveUsd) * 10_000 : Number.POSITIVE_INFINITY;
  const netBps = carryBps + spreadBps - rtCostBps - gasBps;
  return { netBps, apyDeltaBps, carryBps, spreadBps, rtCostBps, gasBps, txEst };
}

const fmtBps = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)}bps` : "unquotable");

export const MentoCarryArb: Strategy = {
  id: "MentoCarryArb",
  describe: (p) =>
    `Mento-only carry/arb across cUSD/USDC/USDT: rotate when Aave carry + broker quote misalignment beats round-trip cost + gas by ${p.minEdgeBps}bps; ≤${p.maxPositionPct}% of book per move, ${Number(p.reserveBps) / 100}% cUSD reserve`,
  evaluate(ctx, pf, params) {
    const minEdge = Number(params.minEdgeBps);
    // mutation jitters genomes ±20%; clamp so >100% of book is never moved
    const maxPosPct = Math.min(100, Math.max(1, Number(params.maxPositionPct)));
    const reserveBps = Number(params.reserveBps);
    const reserveUsd = (pf.totalUsd * reserveBps) / 10_000;
    const actions: Action[] = [];

    // dominant holding across wallet + Aave
    const current = CARRY_ASSETS.reduce((a, b) => (carryUsd(pf, a) >= carryUsd(pf, b) ? a : b));
    const dec = TOKEN_DECIMALS[current];

    // position sizing: genome cap, reserve carve-out (cUSD stays home), $5/tx rail
    const availUsd = carryUsd(pf, current) - (current === "USDm" ? reserveUsd : 0);
    const moveUsd = Math.min((pf.totalUsd * maxPosPct) / 100, availUsd, MAX_TX_USD);

    const candidates = CARRY_ASSETS.filter((t) => t !== current).map((target) => ({
      target,
      e: carryMoveEdgeBps(ctx, current, target, Math.max(moveUsd, 0)),
    }));
    const summary = candidates
      .map(
        ({ target, e }) =>
          `${current}→${target} net ${fmtBps(e.netBps)} (carry ${fmtBps(e.carryBps)} over ${CARRY_HOLD_HOURS}h + spread ${fmtBps(e.spreadBps)} − round-trip ${fmtBps(e.rtCostBps)} − gas ${fmtBps(e.gasBps)})`,
      )
      .join("; ");
    const best = candidates
      .filter((c) => Number.isFinite(c.e.netBps))
      .sort((a, b) => b.e.netBps - a.e.netBps)[0];

    if (best && best.e.netBps > minEdge && moveUsd >= MIN_ACTION_USD) {
      const { target, e } = best;
      const why = `carry edge ${current}→${target}: net ${e.netBps.toFixed(1)}bps (Aave APY delta ${e.apyDeltaBps.toFixed(0)}bps ≈ ${e.carryBps.toFixed(1)}bps over a ${CARRY_HOLD_HOURS}h hold, quote misalignment ${e.spreadBps.toFixed(1)}bps, round-trip cost ${e.rtCostBps.toFixed(1)}bps, gas ${e.gasBps.toFixed(1)}bps) clears the ${minEdge}bps threshold`;
      const moveUnits = parseUnits(moveUsd.toFixed(dec), dec);

      // free up the moved amount from Aave if the wallet alone can't cover it
      const walletUnits = pf.wallet[current] ?? 0n;
      const aaveUnits = pf.aave[current] ?? 0n;
      if (moveUnits > walletUnits && aaveUnits > 0n) {
        const shortfall = moveUnits - walletUnits;
        actions.push({
          kind: "aave-withdraw",
          asset: current,
          amount: shortfall >= aaveUnits ? "max" : shortfall,
          usdValue: Math.min(moveUsd, Number(formatUnits(shortfall, dec))),
          reason: `withdraw ${current} from Aave to fund the rotation — ${why}`,
        });
      }
      if (current !== "USDm") {
        actions.push({
          kind: "mento-swap",
          tokenIn: current,
          tokenOut: "USDm",
          amountIn: moveUnits,
          usdValue: moveUsd,
          reason: `${why} — leg 1: ${current} → cUSD via the Mento broker`,
        });
      }
      if (target !== "USDm") {
        actions.push({
          kind: "mento-swap",
          tokenIn: "USDm",
          tokenOut: target,
          amountIn: current === "USDm" ? moveUnits : -1n, // -1n = post-leg-1 balance (executor resolves)
          usdValue: moveUsd,
          reason: `${why}${current === "USDm" ? "" : " — leg 2: cUSD → " + target + " via the Mento broker"}`,
        });
        actions.push({
          kind: "aave-supply",
          asset: target,
          amount: -1n, // post-swap balance (executor resolves)
          usdValue: moveUsd,
          reason: `supply rotated ${target} to Aave at ${ctx.aaveApyPct[target].toFixed(2)}% APY (the carry leg of the rotation)`,
        });
      } else {
        // landing back in cUSD: supply what exceeds the idle reserve
        const idleAfterUsd = Number(formatUnits(pf.wallet.USDm ?? 0n, 18)) + moveUsd;
        const supplyUsd = Math.min(idleAfterUsd - reserveUsd, MAX_TX_USD);
        if (supplyUsd >= MIN_ACTION_USD) {
          actions.push({
            kind: "aave-supply",
            asset: "USDm",
            amount: parseUnits(supplyUsd.toFixed(18), 18),
            usdValue: supplyUsd,
            reason: `supply rotated cUSD to Aave at ${ctx.aaveApyPct.USDm.toFixed(2)}% APY, keeping the ${reserveBps / 100}% reserve idle`,
          });
        }
      }
      return actions;
    }

    // no rotation clears the bar — keep idle balance above the reserve earning
    // carry in the asset we already hold (no swap, supply only)
    const idleUsd = Number(formatUnits(pf.wallet[current] ?? 0n, dec));
    const deployUsd = Math.min(idleUsd - reserveUsd, MAX_TX_USD);
    if (deployUsd >= MIN_ACTION_USD) {
      actions.push({
        kind: "aave-supply",
        asset: current,
        amount: parseUnits(deployUsd.toFixed(dec), dec),
        usdValue: deployUsd,
        reason: `no rotation clears the ${minEdge}bps carry bar (${summary}); deploying idle ${current} above the ${reserveBps / 100}% reserve into Aave at ${ctx.aaveApyPct[current].toFixed(2)}% APY`,
      });
    }

    if (actions.length === 0) {
      actions.push({
        kind: "hold",
        reason: `observed spread vs threshold: ${summary} — best net edge ${best ? fmtBps(best.e.netBps) : "unquotable"} ≤ minEdgeBps ${minEdge}; holding ${current}`,
      });
    }
    return actions;
  },
};

export const STRATEGIES: Record<StrategyId, Strategy> = {
  MentoFXRotator,
  AaveYielder,
  HedgedCarry,
  MentoCarryArb,
};

export function strategyFor(spec: AgentSpec): Strategy {
  return STRATEGIES[spec.strategy];
}
