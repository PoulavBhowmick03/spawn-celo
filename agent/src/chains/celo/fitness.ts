/**
 * Fitness engine — PURE functions, no I/O. Every input is reconstructible
 * from Celoscan (balances at epoch boundaries, gas paid); a third party can
 * recompute every reputation score we post. The README documents this exact
 * formula; if you change it here, change it there.
 *
 *   epoch_return   = V_end / V_start              (portfolio marked in cUSD)
 *   annualize(r)   = (r - 1) * (8760 / epoch_hours)     [linear annualization]
 *   gas_penalty    = (gas_usd / V_start) * (8760 / epoch_hours)
 *   fitness        = annualize(epoch_return) - gas_penalty
 *   reputation     = clamp(round(50 + 500 * (fitness - swarm_median)), 0, 100)
 */

export type EpochAgentInputs = {
  /** portfolio value in cUSD at epoch start (Celoscan-reconstructible) */
  vStartUsd: number;
  /** portfolio value in cUSD at epoch end */
  vEndUsd: number;
  /** total gas paid during the epoch, in cUSD */
  gasUsd: number;
  epochHours: number;
};

const HOURS_PER_YEAR = 8760;

export function fitness(i: EpochAgentInputs): number {
  if (i.vStartUsd <= 0) throw new Error("vStartUsd must be > 0");
  if (i.epochHours <= 0) throw new Error("epochHours must be > 0");
  const periodsPerYear = HOURS_PER_YEAR / i.epochHours;
  const annualizedReturn = (i.vEndUsd / i.vStartUsd - 1) * periodsPerYear;
  const gasPenalty = (i.gasUsd / i.vStartUsd) * periodsPerYear;
  return annualizedReturn - gasPenalty;
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median of empty set");
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Bounded 0-100 integer score posted to the ERC-8004 Reputation Registry. */
export function reputationScore(agentFitness: number, swarmMedian: number): number {
  const raw = Math.round(50 + 500 * (agentFitness - swarmMedian));
  return Math.min(100, Math.max(0, raw));
}

/** Bottom-20% cull set (minimum swarm size 5, CLAUDE.md §3.3). */
export function selectCulls<T extends { fitness: number }>(agents: T[], minSwarm = 5): T[] {
  const cullCount = Math.min(
    Math.floor(agents.length * 0.2),
    Math.max(0, agents.length - minSwarm),
  );
  if (cullCount === 0) return [];
  return [...agents].sort((a, b) => a.fitness - b.fitness).slice(0, cullCount);
}
