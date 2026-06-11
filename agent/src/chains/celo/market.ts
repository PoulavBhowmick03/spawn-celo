/**
 * Market context for strategy evaluation (Phase 4). One snapshot per epoch:
 * Mento mid-quotes for the FX legs, round-trip swap costs, and Aave supply
 * APYs. Strategies are pure functions of (context, portfolio, params); all
 * context inputs come from onchain reads so decisions are auditable.
 */

import { formatUnits, parseUnits, type Address } from "viem";
import { TOKENS, TOKEN_DECIMALS } from "./addresses.js";
import { quoteSwap } from "./mento.js";
import { getSupplyApy, type AaveAsset } from "./aave.js";

export type FxLeg = "EURm" | "BRLm";
export const FX_LEGS: FxLeg[] = ["EURm", "BRLm"];
export const AAVE_CHOICES: AaveAsset[] = ["USDC", "USDT", "USDm"];
/** USD stables quoted against cUSD on the Mento broker (MentoCarryArb legs). */
export type StableLeg = "USDC" | "USDT";
export const STABLE_LEGS: StableLeg[] = ["USDC", "USDT"];

export type MarketContext = {
  timestamp: number;
  /** cUSD value of 1 unit of each FX leg (mid, from Mento quote of 1 token) */
  fxUsdPrice: Record<FxLeg, number>;
  /** round-trip cost in bps of cUSD -> leg -> cUSD for a $1 probe */
  fxRoundTripCostBps: Record<FxLeg, number>;
  /** momentum in bps vs the previous epoch snapshot (0 when no history) */
  fxMomentumBps: Record<FxLeg, number>;
  /**
   * Round-trip cost in bps of cUSD -> stable -> cUSD for a $1 probe through
   * the Mento broker (same probe method as fxRoundTripCostBps). Deliberately
   * NOT clamped at 0: a negative value is a live quote misalignment a third
   * party can verify with the same two broker quotes. +Infinity = pair
   * unquotable this epoch (leg untradeable).
   */
  stableRoundTripCostBps: Record<StableLeg, number>;
  /**
   * One-way quote misalignment vs 1:1 USD parity, in bps, from the same $1
   * probe: entry = cUSD -> stable (positive means the broker hands out more
   * than $1 of the stable per cUSD), exit = stable -> cUSD per stable unit.
   * entry + exit ≈ -stableRoundTripCostBps by construction.
   */
  stableEntryEdgeBps: Record<StableLeg, number>;
  stableExitEdgeBps: Record<StableLeg, number>;
  aaveApyPct: Record<AaveAsset, number>;
};

export type PreviousSnapshot = { fxUsdPrice?: Record<FxLeg, number> } | undefined;

export async function snapshotMarket(prev: PreviousSnapshot): Promise<MarketContext> {
  const one18 = parseUnits("1", 18);

  const fxUsdPrice = {} as Record<FxLeg, number>;
  const fxRoundTripCostBps = {} as Record<FxLeg, number>;
  const fxMomentumBps = {} as Record<FxLeg, number>;

  for (const leg of FX_LEGS) {
    const legAddr = TOKENS[leg] as Address;
    try {
      // price: cUSD received for 1 leg token
      const out = await quoteSwap(legAddr, TOKENS.USDm, one18);
      fxUsdPrice[leg] = Number(formatUnits(out, 18));

      // round trip: $1 of cUSD -> leg -> cUSD
      const legAmount = await quoteSwap(TOKENS.USDm, legAddr, one18);
      const back = await quoteSwap(legAddr, TOKENS.USDm, legAmount);
      const recovered = Number(formatUnits(back, 18));
      fxRoundTripCostBps[leg] = Math.max(0, (1 - recovered) * 10_000);

      const prevPrice = prev?.fxUsdPrice?.[leg];
      fxMomentumBps[leg] = prevPrice ? ((fxUsdPrice[leg] - prevPrice) / prevPrice) * 10_000 : 0;
    } catch (e) {
      // Mento FX pools close outside forex market hours (FXMarketClosed) —
      // real on weekends, always on a static fork (stale oracles). Carry the
      // last known price for valuation, and make the leg untradeable this
      // epoch by pricing its round trip at infinity.
      const prevPrice = prev?.fxUsdPrice?.[leg];
      fxUsdPrice[leg] = prevPrice ?? 0;
      fxRoundTripCostBps[leg] = Number.POSITIVE_INFINITY;
      fxMomentumBps[leg] = 0;
      console.warn(
        `market: ${leg} quote unavailable (${(e as Error).message?.slice(0, 80)}) — FX market closed? Leg untradeable this epoch, valued at last known price ${prevPrice ?? "0 (none)"}`,
      );
    }
  }

  // USD-stable legs (USDC/USDT vs cUSD) — one quote pair per asset, exactly
  // the FX round-trip probe but with parity (1:1 USD) as the fair mid, so the
  // one-way misalignment is observable too.
  const stableRoundTripCostBps = {} as Record<StableLeg, number>;
  const stableEntryEdgeBps = {} as Record<StableLeg, number>;
  const stableExitEdgeBps = {} as Record<StableLeg, number>;
  for (const leg of STABLE_LEGS) {
    try {
      const dec = TOKEN_DECIMALS[leg];
      // $1 of cUSD -> stable, then the received amount back -> cUSD
      const out = await quoteSwap(TOKENS.USDm, TOKENS[leg] as Address, one18);
      const back = await quoteSwap(TOKENS[leg] as Address, TOKENS.USDm, out);
      const outUnits = Number(formatUnits(out, dec));
      const recovered = Number(formatUnits(back, 18));
      stableEntryEdgeBps[leg] = (outUnits - 1) * 10_000;
      stableExitEdgeBps[leg] = outUnits > 0 ? (recovered / outUnits - 1) * 10_000 : 0;
      stableRoundTripCostBps[leg] = (1 - recovered) * 10_000;
    } catch (e) {
      stableRoundTripCostBps[leg] = Number.POSITIVE_INFINITY;
      stableEntryEdgeBps[leg] = 0;
      stableExitEdgeBps[leg] = 0;
      console.warn(
        `market: ${leg}/cUSD quote unavailable (${(e as Error).message?.slice(0, 80)}) — stable leg untradeable this epoch`,
      );
    }
  }

  const aaveApyPct = {} as Record<AaveAsset, number>;
  for (const asset of AAVE_CHOICES) {
    aaveApyPct[asset] = await getSupplyApy(asset);
  }

  return {
    timestamp: Date.now(),
    fxUsdPrice,
    fxRoundTripCostBps,
    fxMomentumBps,
    stableRoundTripCostBps,
    stableEntryEdgeBps,
    stableExitEdgeBps,
    aaveApyPct,
  };
}
