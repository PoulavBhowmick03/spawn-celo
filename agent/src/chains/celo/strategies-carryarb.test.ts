/**
 * Deterministic unit tests for MentoCarryArb (CLAUDE.md §5: strategy intent
 * generation against mocked market context).
 *   npm run test:carryarb
 */

import assert from "node:assert/strict";
import { parseUnits } from "viem";
import type { MarketContext } from "./market.js";
import type { Portfolio } from "./portfolio.js";
import { MentoCarryArb, STRATEGIES, carryMoveEdgeBps, strategyFor } from "./strategies.js";
import { CARRY_ARB_SPECS } from "./agents-config.js";

const MAX_TX_USD = 5; // budget.ts default (env unset in tests)

function ctxWith(over: Partial<MarketContext> = {}): MarketContext {
  return {
    timestamp: 0,
    fxUsdPrice: { EURm: 1.08, BRLm: 0.18 },
    fxRoundTripCostBps: { EURm: 30, BRLm: 60 },
    fxMomentumBps: { EURm: 0, BRLm: 0 },
    stableRoundTripCostBps: { USDC: 6, USDT: 8 },
    stableEntryEdgeBps: { USDC: -3, USDT: -4 },
    stableExitEdgeBps: { USDC: -3, USDT: -4 },
    aaveApyPct: { USDC: 4, USDT: 4, USDm: 4 },
    ...over,
  };
}

function pfWith(
  wallet: Portfolio["wallet"],
  aave: Portfolio["aave"],
  totalUsd: number,
): Portfolio {
  return { wallet, aave, totalUsd };
}

const PARAMS = { minEdgeBps: 10, maxPositionPct: 80, reserveBps: 500 };

// ---------------------------------------------------------------------------
// registration
assert.equal(STRATEGIES.MentoCarryArb, MentoCarryArb);
assert.equal(strategyFor(CARRY_ARB_SPECS[0]), MentoCarryArb);
assert.match(MentoCarryArb.describe(PARAMS), /Mento-only/);
assert.match(MentoCarryArb.describe(PARAMS), /10bps/);

// ---------------------------------------------------------------------------
// edge formula: netBps = carryBps + spreadBps − rtCostBps − gasBps
{
  const ctx = ctxWith({ aaveApyPct: { USDC: 12, USDT: 4, USDm: 0.5 } });
  const e = carryMoveEdgeBps(ctx, "USDm", "USDC", 4);
  // APY delta 1150bps → carry over 168h hold = 1150 * 168/8760
  assert.ok(Math.abs(e.apyDeltaBps - 1150) < 1e-9);
  assert.ok(Math.abs(e.carryBps - 1150 * (168 / 8760)) < 1e-9);
  assert.equal(e.spreadBps, -3); // entry edge of USDC, no exit leg from cUSD
  assert.equal(e.rtCostBps, 6);
  // 1 swap + 1 supply = 2 txs at $0.002 over $4 = 10bps
  assert.ok(Math.abs(e.gasBps - 10) < 1e-9);
  assert.ok(Math.abs(e.netBps - (e.carryBps - 3 - 6 - 10)) < 1e-9);
}

// ---------------------------------------------------------------------------
// (a) holds below threshold, reason quantifies observed spread vs threshold
{
  // flat APYs, aligned quotes, book already supplied → nothing to do
  const ctx = ctxWith();
  const pf = pfWith(
    { USDm: parseUnits("0.25", 18) },
    { USDm: parseUnits("4.75", 18) },
    5,
  );
  const actions = MentoCarryArb.evaluate(ctx, pf, PARAMS);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, "hold");
  assert.match(actions[0].reason, /spread/);
  assert.match(actions[0].reason, /round-trip/);
  assert.match(actions[0].reason, /minEdgeBps 10/);
  assert.match(actions[0].reason, /USDm→USDC net -?\d+\.\d/);
}

// unquotable stable legs (FX-closed analogue) must not crash and must hold
{
  const ctx = ctxWith({
    stableRoundTripCostBps: { USDC: Number.POSITIVE_INFINITY, USDT: Number.POSITIVE_INFINITY },
    stableEntryEdgeBps: { USDC: 0, USDT: 0 },
    stableExitEdgeBps: { USDC: 0, USDT: 0 },
    aaveApyPct: { USDC: 12, USDT: 12, USDm: 0.5 }, // big APY gap, but no quotes
  });
  const pf = pfWith({ USDm: parseUnits("0.25", 18) }, { USDm: parseUnits("4.75", 18) }, 5);
  const actions = MentoCarryArb.evaluate(ctx, pf, PARAMS);
  assert.equal(actions[0].kind, "hold");
  assert.match(actions[0].reason, /unquotable/);
}

// ---------------------------------------------------------------------------
// (b) acts above threshold: correct direction + sizing (maxPositionPct, reserveBps)
{
  // USDC pays 12% vs 0.5% on cUSD and its entry quote is misaligned +6bps:
  // net = 22.05 (carry) + 6 (spread) − 4 (round trip) − 10 (gas) = 14.05 > 10
  const ctx = ctxWith({
    aaveApyPct: { USDC: 12, USDT: 1, USDm: 0.5 },
    stableRoundTripCostBps: { USDC: 4, USDT: 8 },
    stableEntryEdgeBps: { USDC: 6, USDT: -4 },
    stableExitEdgeBps: { USDC: -10, USDT: -4 },
  });
  const pf = pfWith({ USDm: parseUnits("5", 18) }, {}, 5);
  const actions = MentoCarryArb.evaluate(ctx, pf, PARAMS);
  assert.equal(actions.length, 2);
  // direction: into USDC, not USDT
  assert.equal(actions[0].kind, "mento-swap");
  assert.ok(actions[0].kind === "mento-swap" && actions[0].tokenIn === "USDm");
  assert.ok(actions[0].kind === "mento-swap" && actions[0].tokenOut === "USDC");
  // sizing: maxPositionPct 80% of $5 book = $4 (< the $4.75 above reserve)
  assert.ok(actions[0].kind === "mento-swap" && actions[0].amountIn === parseUnits("4", 18));
  assert.ok(Math.abs((actions[0] as { usdValue: number }).usdValue - 4) < 1e-9);
  assert.match(actions[0].reason, /clears the 10bps threshold/);
  // composed carry leg, HedgedCarry-style: supply the swapped USDC
  assert.equal(actions[1].kind, "aave-supply");
  assert.ok(actions[1].kind === "aave-supply" && actions[1].asset === "USDC");
  assert.ok(actions[1].kind === "aave-supply" && actions[1].amount === -1n);

  // with maxPositionPct 100 the reserve (5% of $5 = $0.25) is the binding cap
  const actions100 = MentoCarryArb.evaluate(ctx, pf, { ...PARAMS, maxPositionPct: 100 });
  assert.ok(actions100[0].kind === "mento-swap" && actions100[0].amountIn === parseUnits("4.75", 18));

  // mutation can push maxPositionPct over 100 — must clamp, not over-move
  const actions120 = MentoCarryArb.evaluate(ctx, pf, { ...PARAMS, maxPositionPct: 120 });
  assert.ok(actions120[0].kind === "mento-swap" && actions120[0].amountIn === parseUnits("4.75", 18));
}

// reverse direction: book supplied in USDC, cUSD is now the better stable →
// withdraw, swap back, re-supply (reserve stays idle in cUSD)
{
  const ctx = ctxWith({
    aaveApyPct: { USDC: 0.5, USDT: 0.5, USDm: 12 },
    stableRoundTripCostBps: { USDC: 4, USDT: 8 },
    stableEntryEdgeBps: { USDC: -10, USDT: -4 },
    stableExitEdgeBps: { USDC: 6, USDT: -4 },
  });
  const pf = pfWith({ USDm: parseUnits("0.5", 18) }, { USDC: parseUnits("4.5", 6) }, 5);
  const actions = MentoCarryArb.evaluate(ctx, pf, PARAMS);
  assert.deepEqual(
    actions.map((a) => a.kind),
    ["aave-withdraw", "mento-swap", "aave-supply"],
  );
  // withdraw exactly the $4 move (wallet holds no USDC)
  assert.ok(actions[0].kind === "aave-withdraw" && actions[0].asset === "USDC");
  assert.ok(actions[0].kind === "aave-withdraw" && actions[0].amount === parseUnits("4", 6));
  assert.ok(actions[1].kind === "mento-swap" && actions[1].tokenIn === "USDC");
  assert.ok(actions[1].kind === "mento-swap" && actions[1].tokenOut === "USDm");
  assert.ok(actions[1].kind === "mento-swap" && actions[1].amountIn === parseUnits("4", 6));
  // re-supply cUSD net of the 5% reserve: ($0.5 idle + $4 moved) − $0.25
  assert.ok(actions[2].kind === "aave-supply" && actions[2].asset === "USDm");
  assert.ok(actions[2].kind === "aave-supply" && actions[2].amount === parseUnits("4.25", 18));
}

// idle deploy without a rotation edge: supply idle above reserve, no swap
{
  const ctx = ctxWith();
  const pf = pfWith({ USDm: parseUnits("5", 18) }, {}, 5);
  const actions = MentoCarryArb.evaluate(ctx, pf, PARAMS);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, "aave-supply");
  assert.ok(actions[0].kind === "aave-supply" && actions[0].asset === "USDm");
  assert.ok(actions[0].kind === "aave-supply" && actions[0].amount === parseUnits("4.75", 18));
  assert.match(actions[0].reason, /no rotation clears the 10bps carry bar/);
}

// ---------------------------------------------------------------------------
// (c) never emits an action moving more than $5 (per-tx cap) — cap, don't burst
{
  const ctx = ctxWith({
    aaveApyPct: { USDC: 15, USDT: 1, USDm: 0.5 },
    stableRoundTripCostBps: { USDC: 2, USDT: 8 },
    stableEntryEdgeBps: { USDC: 8, USDT: -4 },
    stableExitEdgeBps: { USDC: -10, USDT: -4 },
  });
  // hypothetical oversized book: $20 all in wallet cUSD, no reserve, full-book genome
  const pf = pfWith({ USDm: parseUnits("20", 18) }, {}, 20);
  const actions = MentoCarryArb.evaluate(ctx, pf, {
    minEdgeBps: 10,
    maxPositionPct: 100,
    reserveBps: 0,
  });
  assert.ok(actions.length >= 1 && actions[0].kind !== "hold");
  for (const a of actions) {
    if (a.kind === "hold") continue;
    assert.ok(a.usdValue <= MAX_TX_USD + 1e-9, `${a.kind} moves $${a.usdValue} > $5 cap`);
    if (a.kind === "mento-swap" && a.amountIn !== -1n) {
      assert.ok(a.amountIn <= parseUnits("5", 18), "swap amountIn exceeds $5 in units");
    }
    if (a.kind === "aave-supply" && a.amount !== -1n) {
      assert.ok(a.amount <= parseUnits("5", 18), "supply amount exceeds $5 in units");
    }
  }
  // same cap holds on the idle-deploy path
  const idle = MentoCarryArb.evaluate(ctxWith(), pf, PARAMS);
  for (const a of idle) {
    if (a.kind === "hold") continue;
    assert.ok(a.usdValue <= MAX_TX_USD + 1e-9, `${a.kind} (idle) moves $${a.usdValue} > $5 cap`);
  }
}

console.log("strategies-carryarb.test.ts: all assertions passed");
