"use client";

import { useEffect, useState } from "react";
import { getLineage, ipfsUrl } from "@/lib/mantle";

type Props = { lineageKey?: string };

type TreeNode = {
  id: string;
  gen: string;
  status: "terminated" | "active";
  rx: number;
  ry: number;
  cid?: string;
  inheritedConstraints?: number;
};

const NODE_W = 260;
const NODE_H = 84;
const X_STEP = 120;
const Y_STEP = 130;

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | { kind: "ready"; nodes: TreeNode[]; edges: [string, string][] };

/**
 * Builds the ancestry tree from the real on-chain LineageRegistry.getLineage(key).
 * Each returned CID is a terminated ancestor (oldest → newest). We append one
 * live "active" successor node (the current generation, which has no post-mortem
 * CID yet). If the registry returns nothing, we render an explicit empty state.
 */
function buildTree(cids: string[]): TreeNode[] {
  const nodes: TreeNode[] = cids.map((cid, i) => ({
    id: `g${i}`,
    gen: `GEN ${i}`,
    status: "terminated" as const,
    rx: 60 + i * X_STEP,
    ry: 30 + i * Y_STEP,
    cid,
  }));

  // The current live generation has no termination CID yet.
  const activeIdx = cids.length;
  nodes.push({
    id: `g${activeIdx}`,
    gen: `GEN ${activeIdx}`,
    status: "active",
    rx: 60 + activeIdx * X_STEP,
    ry: 30 + activeIdx * Y_STEP,
    // Each ancestor contributes its inherited failure constraints downstream.
    inheritedConstraints: cids.length || undefined,
  });
  return nodes;
}

export function LineageTree({ lineageKey }: Props) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (!lineageKey) {
      setState({ kind: "empty" });
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const cids = await getLineage(lineageKey);
        if (cancelled) return;
        if (cids.length === 0) {
          // No terminations recorded on-chain for this key yet.
          setState({ kind: "empty" });
          return;
        }
        const nodes = buildTree(cids);
        const edges: [string, string][] = nodes
          .slice(0, -1)
          .map((n, i) => [n.id, nodes[i + 1].id]);
        setState({ kind: "ready", nodes, edges });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to read LineageRegistry",
        });
      }
    };

    setState({ kind: "loading" });
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [lineageKey]);

  if (state.kind === "loading") {
    return (
      <div className="tree-empty" style={{ padding: 32, textAlign: "center", color: "var(--muted, #94a3b8)", fontFamily: "monospace", fontSize: 13 }}>
        Reading LineageRegistry on Mantle…
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="tree-empty" style={{ padding: 32, textAlign: "center", color: "var(--crimson, #f87171)", fontFamily: "monospace", fontSize: 13 }}>
        Could not read on-chain lineage: {state.message}
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <div className="tree-empty" style={{ padding: 32, textAlign: "center", color: "var(--muted, #94a3b8)", fontFamily: "monospace", fontSize: 13 }}>
        No lineage recorded on-chain for{" "}
        <span style={{ color: "var(--blue, #60a5fa)" }}>{lineageKey ?? "this key"}</span> yet.
      </div>
    );
  }

  const { nodes, edges } = state;
  const lastNode = nodes[nodes.length - 1];
  const viewW = lastNode.rx + NODE_W + 220;
  const viewH = lastNode.ry + NODE_H + 60;

  return (
    <svg
      className="tree-svg"
      viewBox={`0 0 ${viewW} ${viewH}`}
      aria-label="Lineage ancestry tree (on-chain LineageRegistry)"
      style={{ display: "block", width: "100%", minWidth: 520 }}
    >
      {/* Edges */}
      {edges.map(([fromId, toId]) => {
        const a = nodes.find((n) => n.id === fromId)!;
        const b = nodes.find((n) => n.id === toId)!;
        const x1 = a.rx + 40;
        const y1 = a.ry + NODE_H;
        const x2 = b.rx + 40;
        const y2 = b.ry;
        const my = (y1 + y2) / 2;
        return (
          <path
            key={`${fromId}-${toId}`}
            className="tree-edge"
            d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const isActive = n.status === "active";
        const statusColor = isActive ? "var(--green)" : "var(--crimson)";
        const statusLabel = isActive ? "ACTIVE" : "TERMINATED";
        const cidUrl = n.cid ? ipfsUrl(n.cid) : "";

        return (
          <g key={n.id} className={`node-${n.status}`}>
            <rect className="node-rect" x={n.rx} y={n.ry} width={NODE_W} height={NODE_H} rx={8} />
            {/* Gen label */}
            <text className="node-meta" x={n.rx + 14} y={n.ry + 22}>
              {n.gen}
            </text>
            {/* Status dot */}
            <circle cx={n.rx + NODE_W - 16} cy={n.ry + 16} r={3} fill={statusColor} />
            {isActive && (
              <circle className="pulse-ring" cx={n.rx + NODE_W - 16} cy={n.ry + 16} r={4} />
            )}
            {/* Status label */}
            <text className="node-name" x={n.rx + 14} y={n.ry + 46} fill={statusColor}>
              {statusLabel}
            </text>
            {/* IPFS CID (real, from chain) for terminated nodes */}
            {n.cid && (
              <text className="node-cid" x={n.rx + 14} y={n.ry + NODE_H + 16}>
                {cidUrl ? (
                  <a href={cidUrl} target="_blank" rel="noopener noreferrer" style={{ fill: "var(--blue)" }}>
                    ipfs · {n.cid.slice(0, 16)}…{n.cid.slice(-6)} ↗
                  </a>
                ) : (
                  <tspan style={{ fill: "var(--muted, #94a3b8)" }}>
                    {n.cid.slice(0, 22)}…
                  </tspan>
                )}
              </text>
            )}
            {/* Constraint tag for the live successor */}
            {n.inheritedConstraints != null && (
              <text className="constraint-tag" x={n.rx + NODE_W + 14} y={n.ry + NODE_H / 2 + 4}>
                ↳ {n.inheritedConstraints} ancestor{n.inheritedConstraints === 1 ? "" : "s"} inherited
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
