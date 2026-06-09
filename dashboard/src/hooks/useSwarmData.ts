"use client";

import { useEffect, useRef, useState } from "react";
import type { ChildState, GenerationStat, SwarmEvent } from "@/types";
import { API_BASE } from "@/lib/mantle";

// ─── API response shapes (control-server wire format) ───────────────────────

type ApiStateResponse = {
  agents: ChildState[];
  cycleCount: number;
  uptime: number;
  isLive: boolean;
  lastEvaluation: number;
  swarmStartTime: number;
};

type ApiRawEvent = {
  type: string;
  timestamp: number;
  lineageKey: string;
  generation: number;
  data: Record<string, unknown>;
};

type ApiEventsResponse = {
  events: ApiRawEvent[];
  total: number;
};

type ApiGenerationResult = {
  lineageKey: string;
  generation: number;
  avgYieldPct: number;
  benchmarkYieldPct: number;
  agentsTerminated: number;
  riskAdjustedScore: number;
  mantlescanLink: string;
};

type ApiGenerationsResponse = {
  generations: ApiGenerationResult[];
};

// ─── Normalizers ─────────────────────────────────────────────────────────────

function normalizeEvent(raw: ApiRawEvent): SwarmEvent {
  const d = raw.data;
  return {
    type: raw.type as SwarmEvent["type"],
    timestamp: typeof raw.timestamp === "number"
      ? new Date(raw.timestamp).toISOString()
      : String(raw.timestamp),
    lineageKey: raw.lineageKey,
    generation: raw.generation,
    agentLabel: String(d.agentLabel ?? ""),
    txHash: (d.txHash ?? d.mantleSpawnTxHash ?? d.mantleRecallTxHash) as string | undefined,
    contractAddress: d.contractAddress as string | undefined,
    currentYieldPct: d.currentYieldPct as number | undefined,
    actionTaken: d.actionTaken as string | undefined,
    rationale: (() => {
      if (d.rationale) return String(d.rationale);
      if (typeof d.decisionPayload === "string") {
        try { return (JSON.parse(d.decisionPayload) as { rationale?: string }).rationale; } catch { /* */ }
      }
      return undefined;
    })(),
    positionSummary: d.positionSummary as string | undefined,
    decisionHash: d.decisionHash as string | undefined,
    amountBps: d.amountBps as number | undefined,
    failureReason: d.failureReason as string | undefined,
    ipfsCid: d.ipfsCid as string | undefined,
    recallTxHash: (d.mantleRecallTxHash ?? d.recallTxHash) as string | undefined,
    newAgentLabel: d.newAgentLabel as string | undefined,
    lineageDepth: d.lineageDepth as number | undefined,
    spawnTxHash: (d.mantleSpawnTxHash ?? d.spawnTxHash) as string | undefined,
    inheritanceConstraints: Array.isArray(d.inheritanceConstraints)
      ? (d.inheritanceConstraints as string[])
      : undefined,
  };
}

function normalizeGeneration(r: ApiGenerationResult): GenerationStat {
  return {
    generation: r.generation,
    agentCount: 0,
    terminatedCount: r.agentsTerminated,
    avgRiskAdjustedScore: r.riskAdjustedScore,
    avgYieldPct: r.avgYieldPct,
    benchmarkYieldPct: r.benchmarkYieldPct,
  };
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function fetchJSON<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

// ─── Generic polling hook ────────────────────────────────────────────────────

type QueryState<T> = {
  data: T;
  loading: boolean;
  error: string | null;
  // True once the control-server has failed repeatedly and we have NO live data.
  // The dashboard renders an explicit "control server unavailable" state — it never
  // substitutes fabricated data. (See AUDIT.md Phase 3.)
  unavailable: boolean;
};

const FAIL_THRESHOLD = 2;

function usePolledResource<TRaw, TOut>(
  path: string,
  initial: TOut,
  intervalMs: number,
  transform: (raw: TRaw) => TOut
): QueryState<TOut> {
  const [state, setState] = useState<QueryState<TOut>>({
    data: initial,
    loading: true,
    error: null,
    unavailable: false,
  });

  const failCount = useRef(0);

  useEffect(() => {
    let cancelled = false;
    failCount.current = 0;

    const load = async () => {
      try {
        const raw = await fetchJSON<TRaw>(path);
        if (!cancelled) {
          failCount.current = 0;
          setState({ data: transform(raw), loading: false, error: null, unavailable: false });
        }
      } catch (error: any) {
        if (!cancelled) {
          failCount.current++;
          setState({
            data: initial,
            loading: false,
            error: error?.message ?? "Request failed",
            unavailable: failCount.current >= FAIL_THRESHOLD,
          });
        }
      }
    };

    load();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [intervalMs, path]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}

// ─── Public hooks ─────────────────────────────────────────────────────────────

type SwarmState = {
  agents: ChildState[];
  swarmStartTime: number;
  cycleCount: number;
  uptime: number;
  isLive: boolean;
  lastEvaluation: number;
};

export function useSwarmData() {
  const state = usePolledResource<ApiStateResponse, SwarmState>(
    "/api/state",
    { agents: [], swarmStartTime: 0, cycleCount: 0, uptime: 0, isLive: false, lastEvaluation: 0 },
    15_000,
    (raw) => ({
      agents: raw.agents ?? [],
      swarmStartTime: raw.swarmStartTime ?? 0,
      cycleCount: raw.cycleCount ?? 0,
      uptime: raw.uptime ?? 0,
      isLive: raw.isLive ?? false,
      lastEvaluation: raw.lastEvaluation ?? 0,
    })
  );
  return {
    children: state.data.agents,
    swarmStartTime: state.data.swarmStartTime,
    cycleCount: state.data.cycleCount,
    uptime: state.data.uptime,
    isLive: state.data.isLive,
    lastEvaluation: state.data.lastEvaluation,
    loading: state.loading,
    error: state.error,
    unavailable: state.unavailable,
  };
}

export function useSwarmEvents() {
  const state = usePolledResource<ApiEventsResponse, SwarmEvent[]>(
    "/api/events",
    [],
    15_000,
    (raw) => (raw.events ?? []).map(normalizeEvent)
  );
  return {
    events: state.data,
    loading: state.loading,
    error: state.error,
    unavailable: state.unavailable,
  };
}

export function useGenerationStats() {
  const state = usePolledResource<ApiGenerationsResponse, GenerationStat[]>(
    "/api/generations",
    [],
    30_000,
    (raw) => (raw.generations ?? []).map(normalizeGeneration)
  );
  return {
    generations: state.data,
    loading: state.loading,
    error: state.error,
    unavailable: state.unavailable,
  };
}

export function useSwarmMeta() {
  return {
    meta: { apiBase: API_BASE },
    loading: false,
    error: null as string | null,
  };
}

export function useChildData(childId: string) {
  const { children, loading, error } = useSwarmData();
  const child = children.find((entry) => entry.agentId === childId) ?? null;
  return { child, voteHistory: [], loading, error };
}
