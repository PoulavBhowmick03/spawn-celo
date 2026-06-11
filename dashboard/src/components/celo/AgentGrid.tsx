"use client";

import { useEffect, useRef, useState } from "react";
import type { SwarmAgent } from "@/lib/celo-data";
import { explorerAddress, explorerTx, scanAgent } from "@/lib/celo";
import {
  agentFitness,
  agentScore,
  agentValue,
  fitnessTone,
  fmtFitness,
  stratColor,
} from "./util";

/** minimal SVG fitness sparkline: line + dots, no axes, no grid */
function Sparkline({ agent }: { agent: SwarmAgent }) {
  const h = agent.history;
  if (h.length === 0) {
    return <p className="sp-spark-label">no settled epochs yet</p>;
  }
  const W = 260;
  const H = 64;
  const PAD = 8;
  const fits = h.map((e) => e.fitness);
  const fMin = Math.min(...fits, 0);
  const fMax = Math.max(...fits, 0);
  const span = fMax - fMin || 1;
  const x = (i: number) => (h.length === 1 ? W / 2 : PAD + (i / (h.length - 1)) * (W - PAD * 2));
  const y = (f: number) => H - PAD - ((f - fMin) / span) * (H - PAD * 2);
  const zeroY = y(0);
  const points = h.map((e, i) => `${x(i)},${y(e.fitness)}`).join(" ");

  return (
    <div>
      <p className="sp-spark-label">fitness across epochs {h[0].epoch}–{h[h.length - 1].epoch}</p>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="fitness history">
        <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="#1A1A2E" strokeDasharray="3 3" />
        <polyline points={points} fill="none" stroke={stratColor(agent.strategy)} strokeWidth="1.5" />
        {h.map((e, i) => (
          <circle
            key={e.epoch}
            cx={x(i)}
            cy={y(e.fitness)}
            r="3"
            fill={e.fitness >= 0 ? "#22D3A1" : "#FF5050"}
          >
            <title>{`epoch ${e.epoch} · fitness ${e.fitness.toFixed(3)} · score ${e.score}/100`}</title>
          </circle>
        ))}
        {agent.generation > 1 && (
          <circle cx={x(0)} cy={y(h[0].fitness)} r="5" fill="none" stroke="#FCFF52" strokeWidth="1">
            <title>spawned (g{agent.generation})</title>
          </circle>
        )}
      </svg>
      <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
        {h.map((e) => (
          <span key={e.epoch} className="num" style={{ fontSize: 10, color: "#8892A4" }}>
            e{e.epoch}: {e.score}
          </span>
        ))}
      </div>
    </div>
  );
}

function repColor(score: number): string {
  // --cull (0) → --text-dim (50) → --signal (100)
  if (score <= 50) {
    return `color-mix(in oklab, #FF5050 ${100 - score * 2}%, #8892A4)`;
  }
  return `color-mix(in oklab, #8892A4 ${100 - (score - 50) * 2}%, #22D3A1)`;
}

function AgentCard({ agent, justSpawned }: { agent: SwarmAgent; justSpawned: boolean }) {
  const [open, setOpen] = useState(false);
  const value = agentValue(agent);
  const fitness = agentFitness(agent);
  const score = agentScore(agent);
  const tone = fitnessTone(fitness);

  return (
    <div
      className={`sp-card${justSpawned ? " just-spawned" : ""}`}
      data-status={agent.status}
      onClick={() => setOpen((o) => !o)}
    >
      <div className="sp-card-head">
        <div className="sp-card-id">
          <span className="sp-status-dot" data-status={agent.status} />
          <div style={{ minWidth: 0 }}>
            <div className="sp-card-name">{agent.slug}</div>
            <div className="sp-strat-tag" style={{ color: stratColor(agent.strategy) }}>
              {agent.strategy}
            </div>
          </div>
        </div>
        <span className="sp-gen-pill">g{agent.generation}</span>
      </div>

      <div className="sp-card-stats">
        <div className="sp-stat">
          <div className="sv num">${value.toFixed(2)}</div>
          <div className="sk">value</div>
        </div>
        <div className="sp-stat">
          <div className={`sv num ${tone}`}>{fmtFitness(fitness)}</div>
          <div className="sk">fitness</div>
        </div>
        <div className="sp-stat">
          <div className="sv num">{score !== null ? score : "—"}</div>
          <div className="sk">score</div>
        </div>
      </div>

      {score !== null && (
        <div className="sp-rep">
          <i style={{ width: `${score}%`, background: repColor(score) }} />
          <span className="rep-tip num">{score}/100</span>
        </div>
      )}

      <div className="sp-card-foot" onClick={(e) => e.stopPropagation()}>
        <a href={scanAgent(agent.erc8004AgentId)} target="_blank" rel="noreferrer">
          8004scan ↗
        </a>
        <a href={explorerAddress(agent.address)} target="_blank" rel="noreferrer">
          wallet ↗
        </a>
        {agent.status === "RETIRED" && agent.recallTxHash && (
          <a href={explorerTx(agent.recallTxHash)} target="_blank" rel="noreferrer">
            recall ↗
          </a>
        )}
      </div>

      {open && (
        <div className="sp-card-expand" onClick={(e) => e.stopPropagation()}>
          <Sparkline agent={agent} />
        </div>
      )}
    </div>
  );
}

export function AgentGrid({ agents }: { agents: SwarmAgent[] }) {
  // track first-seen slugs so a mid-session spawn slides in
  const seenRef = useRef<Set<string> | null>(null);
  const [spawnedNow, setSpawnedNow] = useState<Set<string>>(new Set());

  useEffect(() => {
    const slugs = new Set(agents.map((a) => a.slug));
    if (seenRef.current === null) {
      seenRef.current = slugs; // initial load — nothing animates
      return;
    }
    const fresh = new Set([...slugs].filter((s) => !seenRef.current!.has(s)));
    if (fresh.size > 0) {
      seenRef.current = slugs;
      setSpawnedNow(fresh);
      const t = setTimeout(() => setSpawnedNow(new Set()), 1200);
      return () => clearTimeout(t);
    }
  }, [agents]);

  const lastEpoch = (a: SwarmAgent) => a.history[a.history.length - 1]?.epoch ?? 0;
  const active = agents
    .filter((a) => a.status === "ACTIVE")
    .sort((a, b) => (agentFitness(b) ?? -Infinity) - (agentFitness(a) ?? -Infinity));
  const retired = agents
    .filter((a) => a.status === "RETIRED")
    .sort((a, b) => lastEpoch(b) - lastEpoch(a));

  return (
    <div className="sp-grid">
      {[...active, ...retired].map((a) => (
        <AgentCard key={a.slug} agent={a} justSpawned={spawnedNow.has(a.slug)} />
      ))}
    </div>
  );
}
