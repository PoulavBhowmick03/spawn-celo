/**
 * Market context for strategy evaluation (Phase 4). One snapshot per epoch:
 * Mento mid-quotes for the FX legs, round-trip swap costs, and Aave supply
 * APYs. Strategies are pure functions of (context, portfolio, params); all
 * context inputs come from onchain reads so decisions are auditable.
 */

import { formatUnits, parseUnits, type Address } from "viem";
import { TOKENS } from "./addresses.js";
import { quoteSwap } from "./mento.js";
import { getSupplyApy, type AaveAsset } from "./aave.js";

export type FxLeg = "EURm" | "BRLm";
export const FX_LEGS: FxLeg[] = ["EURm", "BRLm"];
export const AAVE_CHOICES: AaveAsset[] = ["USDC", "USDT", "USDm"];

export type MarketContext = {
  timestamp: number;
  /** cUSD value of 1 unit of each FX leg (mid, from Mento quote of 1 token) */
  fxUsdPrice: Record<FxLeg, number>;
  /** round-trip cost in bps of cUSD -> leg -> cUSD for a $1 probe */
  fxRoundTripCostBps: Record<FxLeg, number>;
  /** momentum in bps vs the previous epoch snapshot (0 when no history) */
  fxMomentumBps: Record<FxLeg, number>;
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

  const aaveApyPct = {} as Record<AaveAsset, number>;
  for (const asset of AAVE_CHOICES) {
    aaveApyPct[asset] = await getSupplyApy(asset);
  }

  return {
    timestamp: Date.now(),
    fxUsdPrice,
    fxRoundTripCostBps,
    fxMomentumBps,
    aaveApyPct,
  };
}
