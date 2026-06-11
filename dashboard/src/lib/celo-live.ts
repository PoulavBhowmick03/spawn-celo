"use client";

/**
 * Client-side live polling of the same public GitHub artifacts the server
 * renders from. raw.githubusercontent.com sends CORS * and caches at its
 * CDN for ~300s, so polling faster than ~30s buys no extra freshness —
 * we poll at 30s, which keeps the page live without hammering the CDN.
 */

import { useEffect, useState } from "react";
import { RAW_BASE } from "./celo";
import type { ActivityEntry, EpochReport, SwarmState } from "./celo-data";

const POLL_MS = 30_000;

async function getState(): Promise<SwarmState | null> {
  try {
    const res = await fetch(`${RAW_BASE}/celo_swarm_state.json`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as SwarmState;
  } catch {
    return null;
  }
}

async function getActivity(limit = 500): Promise<ActivityEntry[] | null> {
  try {
    const res = await fetch(`${RAW_BASE}/celo_activity.jsonl`, { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    return text
      .trim()
      .split("\n")
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l) as ActivityEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is ActivityEntry => e !== null)
      .reverse();
  } catch {
    return null;
  }
}

async function getReports(throughEpoch: number): Promise<EpochReport[]> {
  const settled = await Promise.all(
    Array.from({ length: throughEpoch }, (_, i) =>
      fetch(`${RAW_BASE}/docs/epochs/epoch-${i + 1}.json`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<EpochReport>) : null))
        .catch(() => null),
    ),
  );
  return settled.filter((r): r is EpochReport => r !== null).reverse();
}

export function useSwarmLive(initial: {
  state: SwarmState | null;
  activity: ActivityEntry[];
  reports: EpochReport[];
}) {
  const [state, setState] = useState(initial.state);
  const [activity, setActivity] = useState(initial.activity);
  const [reports, setReports] = useState(initial.reports);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      const [s, a] = await Promise.all([getState(), getActivity()]);
      if (stopped) return;
      if (s) {
        setState(s);
        const r = await getReports(s.epochNumber);
        if (!stopped && r.length) setReports(r);
      }
      if (a && a.length) setActivity(a);
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  return { state, activity, reports };
}
