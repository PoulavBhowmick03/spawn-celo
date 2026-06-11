/**
 * Deterministic unit tests for the swarm growth policy (CLAUDE.md §5).
 *   npm run test:growth
 */

import assert from "node:assert/strict";
import { MAX_SWARM_SIZE, OPS_FLOAT_USD, shouldGrowSwarm } from "./growth.js";

// defaults (no env override in tests)
assert.equal(MAX_SWARM_SIZE, 13);
assert.equal(OPS_FLOAT_USD, 1.0);

const base = {
  activeCount: 10,
  pendingCount: 0,
  treasuryUsd: 6.0,
  maxSwarm: 13,
  perAgentUsd: 4,
  opsFloatUsd: 1.0,
  totalBudgetUsd: 50,
  deployedUsd: 40, // 10 active × $4
};

// happy path: below max, treasury covers stake + float, budget room → grow
{
  const d = shouldGrowSwarm(base);
  assert.equal(d.grow, true);
  assert.match(d.reason, /growing by 1/);
}

// hard max: 13 active + 0 pending → no growth
{
  const d = shouldGrowSwarm({ ...base, activeCount: 13, deployedUsd: 52 });
  assert.equal(d.grow, false);
  assert.match(d.reason, /max size/);
}

// pending spawns count toward the cap: 10 active + 3 pending = 13 → no growth
{
  const d = shouldGrowSwarm({ ...base, pendingCount: 3, deployedUsd: 52 });
  assert.equal(d.grow, false);
  assert.match(d.reason, /max size/);
}

// 12 active + 0 pending = room for exactly one more → grow
{
  const d = shouldGrowSwarm({ ...base, activeCount: 12, treasuryUsd: 5.5, deployedUsd: 48 });
  assert.equal(d.grow, false); // 48 + 4 = 52 > 50 → budget guard fires first
  assert.match(d.reason, /budget guard/);
}

// treasury threshold is STRICT: exactly stake + float ($5.00) → no growth
{
  const d = shouldGrowSwarm({ ...base, treasuryUsd: 5.0 });
  assert.equal(d.grow, false);
  assert.match(d.reason, /ops float/);
}

// one cent over the threshold → grow
{
  const d = shouldGrowSwarm({ ...base, treasuryUsd: 5.01 });
  assert.equal(d.grow, true);
}

// empty treasury → no growth
{
  const d = shouldGrowSwarm({ ...base, treasuryUsd: 0 });
  assert.equal(d.grow, false);
  assert.match(d.reason, /ops float/);
}

// budget guard: deployed + stake must stay <= total budget
// 46 deployed + 4 stake = 50 → exactly at cap, allowed
{
  const d = shouldGrowSwarm({ ...base, activeCount: 11, deployedUsd: 46, treasuryUsd: 6 });
  assert.equal(d.grow, true);
}
// 46.5 deployed + 4 stake = 50.5 > 50 → refused
{
  const d = shouldGrowSwarm({ ...base, activeCount: 11, deployedUsd: 46.5, treasuryUsd: 6 });
  assert.equal(d.grow, false);
  assert.match(d.reason, /budget guard/);
}

// pending spawn fundUsd is part of deployed value: 9 active × $4 + one $5
// legacy-funded pending = $41 deployed; 41 + 4 = 45 <= 50 → grow (with room)
{
  const d = shouldGrowSwarm({ ...base, activeCount: 9, pendingCount: 1, deployedUsd: 41 });
  assert.equal(d.grow, true);
}

// invalid inputs never grow (fail-safe, mirrors assertTxAllowed's posture)
{
  assert.equal(shouldGrowSwarm({ ...base, treasuryUsd: NaN }).grow, false);
  assert.equal(shouldGrowSwarm({ ...base, deployedUsd: Infinity }).grow, false);
  assert.equal(shouldGrowSwarm({ ...base, activeCount: -1 }).grow, false);
}

// determinism: identical inputs → identical decision and reason
{
  const a = shouldGrowSwarm(base);
  const b = shouldGrowSwarm(base);
  assert.deepEqual(a, b);
}

console.log("growth.test.ts: all assertions passed");
