"use client";

import { Navbar } from "@/components/Navbar";
import { TerminationEvent } from "@/components/TerminationEvent";
import { useSwarmEvents } from "@/hooks/useSwarmData";
import { explorerTx, formatPct, formatTime, ipfsUrl, type SwarmEvent } from "@/lib/mantle";
import { useMemo, useState } from "react";

const EVENT_TYPES = ["ALL", "SPAWN", "YIELD_REPORT", "TERMINATION", "RESPAWN"] as const;

export default function JudgeFlowPage() {
  const { events, loading, error, unavailable } = useSwarmEvents();

  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [lineageFilter, setLineageFilter] = useState<string>("ALL");

  const lineageKeys = useMemo(() => {
    const keys = Array.from(new Set(events.map((e) => e.lineageKey))).sort();
    return ["ALL", ...keys];
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events
      .filter((e) => typeFilter === "ALL" || e.type === typeFilter)
      .filter((e) => lineageFilter === "ALL" || e.lineageKey === lineageFilter)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [events, typeFilter, lineageFilter]);

  return (
    <>
    <Navbar />
    <div className="dashboard-shell">
      <section className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(88,217,255,0.16),rgba(8,17,31,0.94)_38%,rgba(5,10,19,0.98))] p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#a8f3ff]/70">
          Verifiable Event Trail
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Judge Flow</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-200/75">
          Every spawn, report, termination, and respawn is surfaced directly from the live control-server
          event stream. Post-mortem CIDs and Mantle transaction hashes stay attached to the lifecycle.
        </p>
      </section>

      {unavailable ? (
        <div className="rounded-2xl border border-rose-400/40 bg-rose-500/15 px-5 py-4 text-sm text-rose-100">
          <span className="font-mono uppercase tracking-[0.18em] text-rose-300">
            Control server unavailable
          </span>
          <p className="mt-1 text-rose-100/80">
            No live event stream. This view shows no data rather than fabricated events
            {error ? ` (${error})` : ""}.
          </p>
        </div>
      ) : error ? (
        <div className="rounded-[28px] border border-rose-200/15 bg-rose-500/10 p-6 text-sm text-rose-100">
          Failed to load swarm events: {error}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
          {EVENT_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-3 py-1 text-xs rounded font-mono uppercase tracking-wide transition-colors ${
                typeFilter === t
                  ? "bg-emerald-700 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700"
              }`}
            >
              {t}
            </button>
          ))}

        {lineageKeys.length > 1 && (
          <select
            value={lineageFilter}
            onChange={(e) => setLineageFilter(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300"
          >
            {lineageKeys.map((k) => (
              <option key={k} value={k}>
                {k === "ALL" ? "All lineages" : k}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(filteredEvents, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `spawn-protocol-events-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="ml-auto px-3 py-1 text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 rounded font-mono"
        >
          Export JSON ↓
        </button>
      </div>

      <section className="grid gap-5">
        {filteredEvents.map((event) =>
          event.type === "TERMINATION" ? (
            <TerminationEvent key={`${event.timestamp}-${event.agentLabel}`} event={event} />
          ) : (
            <article
              key={`${event.type}-${event.timestamp}-${event.agentLabel}`}
              className="rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-slate-400">
                    {event.type}
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-white">{event.agentLabel}</h2>
                  <p className="mt-2 text-sm text-slate-300/78">
                    {event.actionTaken
                      ? `Action ${event.actionTaken}`
                      : event.newAgentLabel
                      ? `Respawned as ${event.newAgentLabel}`
                      : `Generation ${event.generation} lineage event`}
                  </p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <div>{formatTime(event.timestamp)}</div>
                  {event.currentYieldPct !== undefined ? (
                    <div className="mt-1 text-slate-200">{formatPct(event.currentYieldPct)}</div>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-300/72">
                {event.txHash ? (
                  <a href={explorerTx(event.txHash)} target="_blank" rel="noreferrer" className="underline decoration-white/20 underline-offset-4">
                    Mantle tx
                  </a>
                ) : null}
                {event.spawnTxHash && event.spawnTxHash !== event.txHash ? (
                  <a href={explorerTx(event.spawnTxHash)} target="_blank" rel="noreferrer" className="underline decoration-white/20 underline-offset-4">
                    Spawn tx
                  </a>
                ) : null}
                {event.ipfsCid && ipfsUrl(event.ipfsCid) ? (
                  <a href={ipfsUrl(event.ipfsCid)} target="_blank" rel="noreferrer" className="underline decoration-white/20 underline-offset-4">
                    IPFS report
                  </a>
                ) : null}
              </div>
            </article>
          )
        )}
        {!loading && filteredEvents.length === 0 ? (
          <div className="rounded-[28px] border border-white/10 bg-black/15 p-8 text-center text-slate-300/72">
            {events.length === 0
              ? "The parent loop has not written `swarm_events.json` yet."
              : "No events match the current filters."}
          </div>
        ) : null}
      </section>
    </div>
    </>
  );
}
