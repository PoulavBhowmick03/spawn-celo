/**
 * Deterministic unit tests for the fitness engine (CLAUDE.md §5).
 *   npm run test:fitness
 */

import assert from "node:assert/strict";
import { fitness, median, reputationScore, selectCulls } from "./fitness.js";

// flat epoch, no gas → fitness 0
assert.equal(fitness({ vStartUsd: 5, vEndUsd: 5, gasUsd: 0, epochHours: 4 }), 0);

// +0.1% in a 4h epoch, no gas → 0.001 * 2190 = 2.19 annualized
assert.ok(Math.abs(fitness({ vStartUsd: 5, vEndUsd: 5.005, gasUsd: 0, epochHours: 4 }) - 2.19) < 1e-9);

// gas penalty subtracts: $0.005 gas on $5 over 4h = 0.001 * 2190 = 2.19
assert.ok(Math.abs(fitness({ vStartUsd: 5, vEndUsd: 5.005, gasUsd: 0.005, epochHours: 4 }) - 0) < 1e-9);

// losing epoch is negative
assert.ok(fitness({ vStartUsd: 5, vEndUsd: 4.95, gasUsd: 0, epochHours: 4 }) < 0);

// external flows are capital, not performance: a $0.35 mid-epoch funding
// top-up on a flat portfolio must score 0, not +153 (the epoch-3 artifact)
assert.equal(fitness({ vStartUsd: 5, vEndUsd: 5.35, netFlowUsd: 0.35, gasUsd: 0, epochHours: 4 }), 0);
// kill-switch sweep + re-fund mid-epoch: vEnd 5.00 after sweeping out 5.34
// and re-funding 5.00 → netFlow -0.34, real P&L 0 (the epoch-4 mirror artifact)
assert.ok(Math.abs(fitness({ vStartUsd: 5.34, vEndUsd: 5, netFlowUsd: -0.34, gasUsd: 0, epochHours: 4 })) < 1e-9);
// flows don't mask real losses: +0.2 funded but vEnd only +0.15 → loss
assert.ok(fitness({ vStartUsd: 5, vEndUsd: 5.15, netFlowUsd: 0.2, gasUsd: 0, epochHours: 4 }) < 0);

// invalid inputs throw
assert.throws(() => fitness({ vStartUsd: 0, vEndUsd: 1, gasUsd: 0, epochHours: 4 }));
assert.throws(() => fitness({ vStartUsd: 1, vEndUsd: 1, gasUsd: 0, epochHours: 0 }));

// median
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 2, 3]), 2.5);
assert.throws(() => median([]));

// reputation: at-median agent scores exactly 50
assert.equal(reputationScore(1.0, 1.0), 50);
// +0.02 over median → 60; -0.02 → 40
assert.equal(reputationScore(1.02, 1.0), 60);
assert.equal(reputationScore(0.98, 1.0), 40);
// clamped at both ends
assert.equal(reputationScore(10, 0), 100);
assert.equal(reputationScore(-10, 0), 0);

// culls: bottom 20% of 9 agents = 1 (floor(1.8)), respecting min swarm 5
const swarm = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((f, i) => ({ id: i, fitness: f }));
const culled = selectCulls(swarm);
assert.equal(culled.length, 1);
assert.equal(culled[0].fitness, 1);
// at minimum swarm size nothing is culled
assert.equal(selectCulls(swarm.slice(0, 5)).length, 0);
// 10 agents → 2 culls
assert.equal(selectCulls([...swarm, { id: 9, fitness: 0 }]).length, 2);

console.log("fitness.test.ts: all assertions passed");
