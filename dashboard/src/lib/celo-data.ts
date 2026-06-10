/**
 * Server-side data layer: the dashboard reads the SAME public artifacts the
 * orchestrator publishes to GitHub every epoch (state, activity log, epoch
 * reports). No private API, no coupling to the swarm host — what judges see
 * here is exactly what they can audit at the repo.
 */

import { RAW_BASE } from "./celo";

export type AgentHistoryEntry = {
  epoch: number;
  fitness: number;
  score: number;
  vEndUsd: number;
  gasUsd: number;
};

export type SwarmAgent = {
  slug: string;
  name: string;
  hdIndex: number;
  address: string;
  erc8004AgentId: string;
  strategy: "MentoFXRotator" | "AaveYielder" | "HedgedCarry";
  params: Record<string, number | boolean>;
  useSignal: boolean;
  generation: number;
  lineageKey: string;
  status: "ACTIVE" | "RETIRED";
  childContract?: string;
  spawnTxHash?: string;
  recallTxHash?: string;
  vStartUsd?: number;
  history: AgentHistoryEntry[];
};

export type SwarmState = {
  epochNumber: number;
  epochStartedAt?: string;
  lastCulledEpoch?: number;
  agents: SwarmAgent[];
};

export type ActivityEntry = {
  timestamp: string;
  agentId: string;
  action: string;
  rationale: string;
  txHash?: string;
  chain: string;
  [k: string]: unknown;
};

export type EpochReport = {
  epoch: number;
  settledAt: string;
  epochHours: number;
  swarmMedianFitness: number;
  culled: string[];
  spawned: string[];
  agents: Array<{
    slug: string;
    erc8004AgentId: string;
    strategy: string;
    generation: number;
    vStartUsd: number;
    vEndUsd: number;
    gasUsd: number;
    fitness: number;
    score: number;
    culled: boolean;
    reputationTx?: string;
  }>;
};

const REVALIDATE = { next: { revalidate: 60 } } as const;

export async function fetchSwarmState(): Promise<SwarmState | null> {
  try {
    const res = await fetch(`${RAW_BASE}/celo_swarm_state.json`, REVALIDATE);
    if (!res.ok) return null;
    return (await res.json()) as SwarmState;
  } catch {
    return null;
  }
}

export async function fetchActivity(limit = 200): Promise<ActivityEntry[]> {
  try {
    const res = await fetch(`${RAW_BASE}/celo_activity.jsonl`, REVALIDATE);
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.trim().split("\n");
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as ActivityEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is ActivityEntry => e !== null)
      .reverse(); // newest first
  } catch {
    return [];
  }
}

export async function fetchEpochReports(throughEpoch: number): Promise<EpochReport[]> {
  const reports: EpochReport[] = [];
  for (let i = 1; i <= throughEpoch; i++) {
    try {
      const res = await fetch(`${RAW_BASE}/docs/epochs/epoch-${i}.json`, REVALIDATE);
      if (res.ok) reports.push((await res.json()) as EpochReport);
    } catch {
      /* unsettled epoch — no report yet */
    }
  }
  return reports.reverse(); // newest first
}
