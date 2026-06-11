"use client";

/**
 * The orbital hero: treasury at center, agents orbiting by generation
 * (g1 outer, descendants inner — closer to the capital they earned).
 * Orbital speed is proportional to fitness, so the competition is
 * literally visible. Retired agents are static ghosts at their last
 * position. 2D ellipses on a raw canvas — no 3D library.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { SwarmAgent } from "@/lib/celo-data";
import { explorerAddress, scanAgent } from "@/lib/celo";
import { LocalTime } from "@/components/LocalTime";
import { agentFitness, agentScore, agentValue, slugAngle, stratColor } from "./util";

type OrbitNode = {
  slug: string;
  strategy: string;
  generation: number;
  status: "ACTIVE" | "RETIRED";
  address: string;
  agentId: string;
  lineageKey: string;
  value: number;
  fitness: number | null;
  score: number | null;
  angle: number;
  angularSpeed: number; // rad/ms
  nodeRadius: number;
  ringScale: number; // 1 = outer (g1)
  x: number;
  y: number;
};

type Hover = { node: OrbitNode; x: number; y: number } | null;

const BASE_SPEED = 0.00012; // rad/ms ≈ one orbit per ~52s

function buildNodes(agents: SwarmAgent[], prev: Map<string, number>): OrbitNode[] {
  const values = agents.map(agentValue).filter((v) => v > 0);
  const vMin = Math.min(...values, Infinity);
  const vMax = Math.max(...values, -Infinity);
  const span = vMax - vMin;

  return agents.map((a) => {
    const value = agentValue(a);
    const fitness = agentFitness(a);
    // clamp: a just-spawned agent has no vStart/history yet (value 0), which
    // would otherwise produce a negative node radius and kill ctx.arc()
    const rel = Math.max(0, Math.min(1, span > 0.001 ? (value - vMin) / span : 0.5));
    // fitness drives speed: 0 → base, positive faster, negative slower
    const f = Math.max(-2, Math.min(2, fitness ?? 0));
    return {
      slug: a.slug,
      strategy: a.strategy,
      generation: a.generation,
      status: a.status,
      address: a.address,
      agentId: a.erc8004AgentId,
      lineageKey: a.lineageKey,
      value,
      fitness,
      score: agentScore(a),
      angle: prev.get(a.slug) ?? slugAngle(a.slug),
      angularSpeed: a.status === "ACTIVE" ? BASE_SPEED * (1 + f * 0.35) : 0,
      nodeRadius: 7 + rel * 6,
      ringScale: Math.max(0.38, 1 - (a.generation - 1) * 0.3),
      x: 0,
      y: 0,
    };
  });
}

export function OrbitalHero({
  agents,
  deployedUsd,
  epochNumber,
  lastSettleIso,
}: {
  agents: SwarmAgent[];
  deployedUsd: number;
  epochNumber: number;
  lastSettleIso?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<OrbitNode[]>([]);
  const hoverRef = useRef<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);

  const active = useMemo(() => agents.filter((a) => a.status === "ACTIVE"), [agents]);
  const retired = useMemo(() => agents.filter((a) => a.status === "RETIRED"), [agents]);
  const maxGen = Math.max(1, ...agents.map((a) => a.generation));

  // rebuild nodes when agent data changes, preserving current angles
  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.slug, n.angle]));
    nodesRef.current = buildNodes(agents, prev);
  }, [agents]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let isMobile = false;
    let raf = 0;
    let last = performance.now();
    let pulse = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      isMobile = rect.width < 640;
      w = rect.width;
      h = isMobile ? 280 : 420;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const draw = (dt: number) => {
      const cx = w / 2;
      const cy = h / 2;
      const outerRx = Math.min(w * 0.42, 520);
      const outerRy = h * 0.36;
      const nodes = nodesRef.current;
      const animate = !reduced && !isMobile;

      ctx.clearRect(0, 0, w, h);

      // ring guides — one per generation present
      const rings = new Set(nodes.map((n) => n.ringScale));
      ctx.strokeStyle = "#1A1A2E";
      ctx.lineWidth = 1;
      for (const s of rings) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, outerRx * s, outerRy * s, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // advance + position
      for (const n of nodes) {
        if (animate && n.status === "ACTIVE" && hoverRef.current !== n.slug) {
          n.angle += n.angularSpeed * dt;
        }
        n.x = cx + outerRx * n.ringScale * Math.cos(n.angle);
        n.y = cy + outerRy * n.ringScale * Math.sin(n.angle);
      }

      // lineage edges: child → parent (same lineageKey, generation − 1)
      ctx.setLineDash([4, 4]);
      for (const child of nodes) {
        if (child.generation <= 1) continue;
        const parent = nodes.find(
          (p) => p.lineageKey === child.lineageKey && p.generation === child.generation - 1,
        );
        if (!parent) continue;
        ctx.strokeStyle = stratColor(child.strategy) + "33";
        ctx.beginPath();
        ctx.moveTo(parent.x, parent.y);
        ctx.lineTo(child.x, child.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // treasury: gold pulsing dot at center
      pulse += dt;
      const pr = 9 + (animate ? Math.sin(pulse / 600) * 1.5 : 0);
      ctx.beginPath();
      ctx.arc(cx, cy, pr + 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(252,255,82,0.08)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.fillStyle = "#FCFF52";
      ctx.fill();
      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = "#8892A4";
      ctx.fillText(`treasury $${deployedUsd.toFixed(2)}`, cx, cy + pr + 18);

      // agent nodes
      for (const n of nodes) {
        const ghost = n.status === "RETIRED";
        ctx.globalAlpha = ghost ? 0.3 : 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = stratColor(n.strategy);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = ghost ? "rgba(255,80,80,0.7)" : "#22D3A1";
        ctx.stroke();
        if (!ghost || hoverRef.current === n.slug) {
          ctx.font = '400 10px "JetBrains Mono", monospace';
          ctx.fillStyle = ghost ? "rgba(136,146,164,0.6)" : "#8892A4";
          ctx.fillText(n.slug, n.x, n.y + n.nodeRadius + 14);
        }
        ctx.globalAlpha = 1;
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      draw(dt);
      raf = requestAnimationFrame(loop);
    };

    if (reduced || window.innerWidth < 640) {
      // static layout: render once, re-render on resize/data only
      draw(0);
      const id = setInterval(() => draw(0), 30_000);
      return () => {
        clearInterval(id);
        ro.disconnect();
      };
    }

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [deployedUsd, agents]);

  // hit-testing → hover card (HTML, so its links are clickable)
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    for (const n of nodesRef.current) {
      const d = Math.hypot(n.x - px, n.y - py);
      if (d <= n.nodeRadius + 6) {
        hoverRef.current = n.slug;
        setHover({ node: n, x: n.x, y: n.y });
        e.currentTarget.style.cursor = "pointer";
        return;
      }
    }
    hoverRef.current = null;
    setHover(null);
    e.currentTarget.style.cursor = "default";
  };

  const cardLeft = hover ? Math.min(Math.max(hover.x - 116, 8), (wrapRef.current?.clientWidth ?? 600) - 240) : 0;
  const cardTop = hover ? Math.max(hover.y - 170, 8) : 0;

  return (
    <div className="sp-orbital" ref={wrapRef} onPointerLeave={() => { hoverRef.current = null; setHover(null); }}>
      <canvas ref={canvasRef} onPointerMove={onPointerMove} />
      {hover && (
        <div className="sp-nodecard" style={{ left: cardLeft, top: cardTop }}>
          <div className="nc-name">{hover.node.slug}</div>
          <div className="nc-strat" style={{ color: stratColor(hover.node.strategy) }}>
            {hover.node.strategy} · g{hover.node.generation}
            {hover.node.status === "RETIRED" && " · retired"}
          </div>
          <div className="nc-row"><span>value</span><span className="v num">${hover.node.value.toFixed(3)}</span></div>
          <div className="nc-row">
            <span>fitness</span>
            <span className="v num">{hover.node.fitness !== null ? hover.node.fitness.toFixed(3) : "—"}</span>
          </div>
          <div className="nc-row">
            <span>reputation</span>
            <span className="v num">{hover.node.score !== null ? `${hover.node.score}/100` : "—"}</span>
          </div>
          <div className="nc-links">
            <a href={scanAgent(hover.node.agentId)} target="_blank" rel="noreferrer">8004scan ↗</a>
            <a href={explorerAddress(hover.node.address)} target="_blank" rel="noreferrer">wallet ↗</a>
          </div>
        </div>
      )}
      <div className="sp-orbital-stats">
        <span className="epoch-counter num">#{epochNumber}</span>
        <span>epoch</span>
        <span className="sep">·</span>
        <span><span className="v num">{active.length}</span> active</span>
        <span className="sep">·</span>
        <span><span className="v num">{retired.length}</span> retired</span>
        <span className="sep">·</span>
        <span>max generation <span className="v num">g{maxGen}</span></span>
        <span className="sep">·</span>
        <span>
          last settle{" "}
          <span className="v">{lastSettleIso ? <LocalTime iso={lastSettleIso} /> : "epoch 1 open"}</span>
        </span>
      </div>
    </div>
  );
}
