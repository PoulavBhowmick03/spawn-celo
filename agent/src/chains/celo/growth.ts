/**
 * Swarm growth policy — pure and deterministic so it is unit-testable and a
 * judge can recompute every growth decision from public data.
 *
 * Track-3 rationale: each spawned agent is one new unique ERC-8004 identity
 * registration. By funding agents to a $4 target (budget.ts) while culled
 * agents return up to $5, every cull leaves ~$1 of margin in the treasury.
 * Once that recycled margin covers a full agent stake plus an ops float, the
 * swarm grows by AT MOST ONE extra agent per epoch — no new outside capital,
 * hard-capped at MAX_SWARM_SIZE agents and the $50 total budget.
 */

/** Hard max on active agents + pending spawns (env-overridable). */
export const MAX_SWARM_SIZE = Number(process.env.SWARM_MAX_AGENTS ?? 13);

/** Treasury cUSD kept back for orchestrator gas/ops, never spent on spawns. */
export const OPS_FLOAT_USD = 1.0;

export type GrowthInputs = {
  /** agents currently ACTIVE (post-cull) */
  activeCount: number;
  /** spawns already enqueued but not yet completed (incl. cull replacements) */
  pendingCount: number;
  /** live treasury cUSD balance */
  treasuryUsd: number;
  /** hard max swarm size (active + pending) */
  maxSwarm: number;
  /** funding target per agent (MAX_AGENT_BALANCE_USD) */
  perAgentUsd: number;
  /** treasury float reserved for ops, on top of the spawn stake */
  opsFloatUsd: number;
  /** total budget hard cap (TOTAL_BUDGET_USD) */
  totalBudgetUsd: number;
  /** already-deployed value: active agents × funding target + Σ pending fundUsd */
  deployedUsd: number;
};

export type GrowthDecision = { grow: boolean; reason: string };

/**
 * Decide whether to enqueue ONE extra growth spawn this epoch. Grows iff:
 *   1. activeCount + pendingCount < maxSwarm, AND
 *   2. treasuryUsd > perAgentUsd + opsFloatUsd (strictly — the ops float is
 *      never spendable on spawns), AND
 *   3. deployedUsd + perAgentUsd <= totalBudgetUsd (total deployed value can
 *      never exceed the hard budget cap).
 */
export function shouldGrowSwarm(inputs: GrowthInputs): GrowthDecision {
  const {
    activeCount,
    pendingCount,
    treasuryUsd,
    maxSwarm,
    perAgentUsd,
    opsFloatUsd,
    totalBudgetUsd,
    deployedUsd,
  } = inputs;

  for (const [name, v] of Object.entries(inputs)) {
    if (!Number.isFinite(v) || v < 0) {
      return { grow: false, reason: `invalid growth input ${name}=${v} — refusing to grow` };
    }
  }

  const swarmSize = activeCount + pendingCount;
  if (swarmSize >= maxSwarm) {
    return {
      grow: false,
      reason: `swarm at max size: ${activeCount} active + ${pendingCount} pending >= cap ${maxSwarm}`,
    };
  }
  const required = perAgentUsd + opsFloatUsd;
  if (treasuryUsd <= required) {
    return {
      grow: false,
      reason: `treasury $${treasuryUsd.toFixed(2)} <= $${perAgentUsd.toFixed(2)} stake + $${opsFloatUsd.toFixed(2)} ops float — recycled cull margin not yet sufficient`,
    };
  }
  if (deployedUsd + perAgentUsd > totalBudgetUsd) {
    return {
      grow: false,
      reason: `budget guard: deployed $${deployedUsd.toFixed(2)} + $${perAgentUsd.toFixed(2)} stake would exceed total budget $${totalBudgetUsd.toFixed(2)}`,
    };
  }
  return {
    grow: true,
    reason: `treasury $${treasuryUsd.toFixed(2)} covers a $${perAgentUsd.toFixed(2)} stake + $${opsFloatUsd.toFixed(2)} ops float with swarm at ${swarmSize}/${maxSwarm} and deployed $${deployedUsd.toFixed(2)}/$${totalBudgetUsd.toFixed(2)} — growing by 1 from recycled cull margin`,
  };
}
