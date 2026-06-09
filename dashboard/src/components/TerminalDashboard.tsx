"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { AgentLivePanel } from "@/components/AgentLivePanel";
import { AgentTerminalFeed } from "@/components/AgentTerminalFeed";
import { GenerationChart } from "@/components/GenerationChart";
import { OnChainEvidence } from "@/components/OnChainEvidence";
import { TerminationEvent } from "@/components/TerminationEvent";
import { LineageTree } from "@/components/LineageTree";
import { useSwarmData, useSwarmEvents, useGenerationStats } from "@/hooks/useSwarmData";
import { explorerTx } from "@/lib/mantle";
import type { SwarmEvent } from "@/types";

type TabId = "overview" | "judge" | "lineage";
type FilterId = "ALL" | "SPAWN" | "YIELD" | "TERMINATION" | "RESPAWN";

const FILTER_MAP: Record<FilterId, string | null> = {
  ALL:         null,
  SPAWN:       "SPAWN",
  YIELD:       "YIELD_REPORT",
  TERMINATION: "TERMINATION",
  RESPAWN:     "RESPAWN",
};

function timeAgo(epochMs: number): string {
  if (!epochMs) return "—";
  const diff = Date.now() - epochMs;
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h ago`;
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

function fmtTs(ts: string): string {
  try {
    return new Date(ts).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  } catch {
    return ts;
  }
}

function eventDesc(event: SwarmEvent): string {
  if (event.type === "SPAWN")
    return `GEN ${event.generation} spawn · lineage ${event.lineageKey}`;
  if (event.type === "YIELD_REPORT")
    return `Cycle closed · ${event.currentYieldPct?.toFixed(2) ?? "—"}% APY · ${event.actionTaken ?? ""}`;
  if (event.type === "TERMINATION")
    return `GEN ${event.generation} · terminated · ${event.inheritanceConstraints?.length ?? 0} constraints emitted`;
  if (event.type === "RESPAWN")
    return `Successor spawned as ${event.newAgentLabel ?? "next gen"} · depth ${event.lineageDepth ?? "?"}`;
  return "";
}

function displayType(type: string): string {
  return type === "YIELD_REPORT" ? "YIELD" : type;
}

function NonTerminationRow({ event }: { event: SwarmEvent }) {
  const type = displayType(event.type);
  const tx = event.txHash ?? event.spawnTxHash ?? event.recallTxHash;
  return (
    <article className="event" data-type={type}>
      <div className="ts">
        {fmtTs(event.timestamp)}
        <span className="blk">GEN {event.generation}</span>
      </div>
      <div>
        <span className="evt-pill" data-type={type}>{type}</span>
      </div>
      <div className="agent-cell">{event.agentLabel}</div>
      <div className="desc">{eventDesc(event)}</div>
      <div>
        {tx ? (
          <a className="ev-link" href={explorerTx(tx)} target="_blank" rel="noopener noreferrer">
            tx {tx.slice(0, 10)}… ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

export default function SpawnDashboard() {
  const [activeTab, setActiveTab]     = useState<TabId>("overview");
  const [eventFilter, setEventFilter] = useState<FilterId>("ALL");
  const [chartKey, setChartKey]       = useState(0);

  const { children, unavailable, swarmStartTime, cycleCount } = useSwarmData();
  const { events }                  = useSwarmEvents();
  const { generations }             = useGenerationStats();

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === "lineage") setChartKey((k) => k + 1);
  };

  const filteredEvents = events
    .filter((e) => FILTER_MAP[eventFilter] === null || e.type === FILTER_MAP[eventFilter])
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const handleExport = () => {
    const payload = {
      generated_at: new Date().toISOString(),
      filter: eventFilter,
      events: filteredEvents,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spawn-protocol-events-${eventFilter.toLowerCase()}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const active    = children.filter((c) => c.status === "ACTIVE");
  const recalled  = children.filter((c) => c.status === "TERMINATED");
  const latestGen = generations[generations.length - 1];
  const firstGen  = generations[0];
  const avgYieldDisplay = latestGen ? latestGen.avgYieldPct.toFixed(2) + "%" : "—";
  const deltaDisplay    = latestGen && firstGen && latestGen !== firstGen
    ? `▲ +${(latestGen.avgYieldPct - firstGen.avgYieldPct).toFixed(2)}%`
    : "—";
  const deltaVs = firstGen ? `vs Gen ${firstGen.generation} (${firstGen.avgYieldPct.toFixed(2)}%)` : "—";

  // Live-computed stats
  const totalConstraints = events
    .filter((e) => e.type === "TERMINATION")
    .reduce((sum, e) => sum + (e.inheritanceConstraints?.length ?? 0), 0);

  const prevActiveRef = useRef(active.length);
  const [activeDelta, setActiveDelta] = useState(0);
  useEffect(() => {
    const delta = active.length - prevActiveRef.current;
    if (delta !== 0) setActiveDelta(delta);
    prevActiveRef.current = active.length;
  }, [active.length]);

  // Lineage tree stats for usde-yield-agent-0
  const l0 = children.filter((c) => c.lineageKey === "usde-yield-agent-0");
  const l0Depth = l0.reduce((max, c) => Math.max(max, c.generation), 0);
  const l0Terminated = l0.filter((c) => c.status === "TERMINATED").length;

  return (
    <>
      {/* TABS */}
      <nav className="tabs" role="tablist" aria-label="Dashboard sections">
        {(["overview", "judge", "lineage"] as TabId[]).map((tab, i) => (
          <button
            key={tab}
            className="tab"
            role="tab"
            aria-selected={activeTab === tab ? "true" : "false"}
            onClick={() => switchTab(tab)}
          >
            <span className="num">0{i + 1}</span>
            {tab === "overview" ? "Swarm Overview" : tab === "judge" ? "Judge Flow" : "Lineage"}
          </button>
        ))}
        <Link href="/community" className="tab" style={{ marginLeft: "auto", textDecoration: "none" }}>
          <span className="num">↗</span>Community Swarm
        </Link>
      </nav>

      {/* ──────────────────────────────── TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div key="overview" className="tab-view">
          {unavailable && (
            <div className="bg-rose-900/40 border border-rose-500/60 text-rose-200 px-4 py-3 text-xs rounded mb-4 font-mono flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse inline-block" />
              CONTROL SERVER UNAVAILABLE — no live swarm data. Showing empty state (no fabricated agents). Deploy the agent backend and set NEXT_PUBLIC_API_URL to connect.
            </div>
          )}

          <OnChainEvidence />

          <div className="sec-head">
            <h1 className="sec-title">Active Swarm</h1>
            <span className="sec-sub">{active.length} active · {recalled.length} recalled</span>
          </div>

          <div className="stats">
            <div className="stat" data-tone="green">
              <span className="corner">01</span>
              <div className="label">Active Agents</div>
              <div className="value">{active.length}</div>
              <div className="delta">
                {activeDelta !== 0
                  ? <><span className="v">{activeDelta > 0 ? `+${activeDelta}` : activeDelta}</span><span>since last poll</span></>
                  : <span>cycle {cycleCount}</span>}
              </div>
            </div>
            <div className="stat" data-tone="blue">
              <span className="corner">02</span>
              <div className="label">Generations</div>
              <div className="value">{generations.length || children.reduce((m, c) => Math.max(m, c.generation), 0)}</div>
              <div className="delta"><span>{swarmStartTime ? `seeded ${timeAgo(swarmStartTime)}` : "—"}</span></div>
            </div>
            <div className="stat" data-tone="red">
              <span className="corner">03</span>
              <div className="label">Recalled</div>
              <div className="value">{recalled.length}</div>
              <div className="delta"><span>{totalConstraints > 0 ? `${totalConstraints} constraints inherited` : `${recalled.length} terminations`}</span></div>
            </div>
            <div className="stat" data-tone="green">
              <span className="corner">04</span>
              <div className="label">Avg Yield · Latest Gen</div>
              <div className="value">{avgYieldDisplay}</div>
              <div className="delta">
                <span className="v">{deltaDisplay}</span>
                <span>{deltaVs}</span>
              </div>
            </div>
          </div>

          {/* ── Active agents with live decision feed ── */}
          <div className="eyebrow" style={{ marginTop: 24 }}>
            Active Agents · {active.length} running
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {active.length === 0 ? (
              <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-3)", padding: "16px 0" }}>
                No active agents — swarm is respawning…
              </div>
            ) : (
              active.map((child) => (
                <AgentLivePanel
                  key={`${child.contractAddress}-${child.generation}`}
                  agent={child}
                  events={events}
                />
              ))
            )}
          </div>

          {/* ── Live decision terminal ── */}
          <div className="eyebrow" style={{ marginTop: 28 }}>
            Agent Decision Log · live feed
          </div>
          <div style={{ marginTop: 10 }}>
            <AgentTerminalFeed events={events} />
          </div>

          {/* ── Terminated footer ── */}
          {recalled.length > 0 && (
            <div style={{
              marginTop: 16,
              padding: "10px 14px",
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
              <span>
                <span style={{ color: "var(--crimson)" }}>●</span>
                {" "}{recalled.length} terminated agents
                {totalConstraints > 0 && ` · ${totalConstraints} constraints emitted`}
              </span>
              <button
                onClick={() => switchTab("judge")}
                style={{
                  background: "none", border: "1px solid var(--border)",
                  color: "var(--ink-2)", fontFamily: "var(--mono)", fontSize: 10,
                  padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                  letterSpacing: "0.06em",
                }}
              >
                View in Judge Flow →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ──────────────────────────────── TAB 2: JUDGE FLOW */}
      {activeTab === "judge" && (
        <div key="judge" className="tab-view">
          <div className="sec-head">
            <h1 className="sec-title">Judge Flow</h1>
            <span className="sec-sub">Verifiable evidence trail · {events.length} events</span>
          </div>

          <div className="flow-controls">
            <div className="filter-group" role="tablist" aria-label="Event filter">
              {(["ALL", "SPAWN", "YIELD", "TERMINATION", "RESPAWN"] as FilterId[]).map((f) => (
                <button
                  key={f}
                  className="filter"
                  role="tab"
                  aria-selected={eventFilter === f ? "true" : "false"}
                  onClick={() => setEventFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <button className="export-btn" onClick={handleExport}>
              Export JSON ↓
            </button>
          </div>

          <div className="feed">
            {filteredEvents.map((event, idx) =>
              event.type === "TERMINATION" ? (
                <TerminationEvent key={`${event.timestamp}-${idx}`} event={event} />
              ) : (
                <NonTerminationRow key={`${event.type}-${event.timestamp}-${idx}`} event={event} />
              )
            )}
            {filteredEvents.length === 0 && (
              <div style={{ padding: "28px 18px", color: "var(--ink-3)", fontFamily: "var(--mono)", fontSize: 12 }}>
                No events match the current filter.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──────────────────────────────── TAB 3: LINEAGE */}
      {activeTab === "lineage" && (
        <div key="lineage" className="tab-view">
          <div className="sec-head">
            <h1 className="sec-title">Lineage</h1>
            <span className="sec-sub">Generational performance · ancestry</span>
          </div>

          <div className="eyebrow">Section A · Generational Performance</div>
          <GenerationChart key={chartKey} data={generations} />

          <div className="eyebrow" style={{ marginTop: 32 }}>Section B · Ancestry Tree</div>
          <div className="tree-frame">
            <div className="tree-head">
              <div>
                <div className="sec-sub" style={{ marginBottom: 4 }}>Lineage Key</div>
                <div className="tree-key">
                  usde-yield-agent · root{" "}
                  <span className="v">0x0466…b59E</span>
                </div>
              </div>
              <div className="tree-key">
                depth <span className="v">{l0Depth || "—"}</span> · descendants{" "}
                <span className="v">{l0.length || "—"}</span> · terminated <span className="v">{l0Terminated || "—"}</span>
              </div>
            </div>
            <div className="tree-svg-wrap">
              <LineageTree lineageKey="usde-yield-agent-0" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
