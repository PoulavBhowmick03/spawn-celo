"use client";

import { useState } from "react";
import type { EpochReport, SwarmAgent } from "@/lib/celo-data";
import { explorerAddress, explorerTx } from "@/lib/celo";
import { LocalTime } from "@/components/LocalTime";

/**
 * One card per epoch, newest first and expanded by default; older epochs
 * collapse to a single line. Chips link to each agent's Celoscan tx list.
 * Note: per-epoch tx counts aren't in the published reports, so chips show
 * the reputation score the orchestrator wrote onchain for that epoch.
 */
export function EpochTimeline({
  reports,
  agents,
}: {
  reports: EpochReport[];
  agents: SwarmAgent[];
}) {
  const [openEpochs, setOpenEpochs] = useState<Set<number>>(
    () => new Set(reports.length ? [reports[0].epoch] : []),
  );
  const addrOf = (slug: string) => agents.find((a) => a.slug === slug)?.address;

  const toggle = (epoch: number) =>
    setOpenEpochs((prev) => {
      const next = new Set(prev);
      if (next.has(epoch)) next.delete(epoch);
      else next.add(epoch);
      return next;
    });

  if (reports.length === 0) {
    return <p className="sub">first epoch not settled yet</p>;
  }

  return (
    <div className="sp-epochs">
      {reports.map((r) => {
        const collapsed = !openEpochs.has(r.epoch);
        return (
          <div
            key={r.epoch}
            className="sp-epoch"
            data-collapsed={collapsed}
            onClick={collapsed ? () => toggle(r.epoch) : undefined}
          >
            <div>
              <div className="sp-epoch-num">{String(r.epoch).padStart(2, "0")}</div>
              <div className="sp-epoch-time">
                <LocalTime iso={r.settledAt} />
              </div>
            </div>

            <div className="sp-epoch-mid">
              <span
                className={`sp-median num ${r.swarmMedianFitness >= 0 ? "pos" : "neg"}`}
                onClick={!collapsed ? () => toggle(r.epoch) : undefined}
                style={!collapsed ? { cursor: "pointer" } : undefined}
                title={collapsed ? undefined : "click to collapse"}
              >
                median {r.swarmMedianFitness >= 0 ? "+" : ""}
                {r.swarmMedianFitness.toFixed(3)}
              </span>
              <div className="sp-chips">
                {r.agents.map((a) => {
                  const addr = addrOf(a.slug);
                  const isSpawned = r.spawned.includes(a.slug);
                  const chip = (
                    <>
                      {a.slug} · <span className="num">{a.score}</span>
                      {a.reputationTx && " ↗"}
                    </>
                  );
                  const href = a.reputationTx
                    ? explorerTx(a.reputationTx)
                    : addr
                      ? explorerAddress(addr)
                      : undefined;
                  return href ? (
                    <a
                      key={a.slug}
                      className="sp-chip"
                      data-culled={a.culled || undefined}
                      data-spawned={isSpawned || undefined}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={`V $${a.vStartUsd.toFixed(3)} → $${a.vEndUsd.toFixed(3)} · gas $${a.gasUsd.toFixed(4)} · fitness ${a.fitness.toFixed(3)}`}
                    >
                      {chip}
                    </a>
                  ) : (
                    <span key={a.slug} className="sp-chip" data-culled={a.culled || undefined}>
                      {chip}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="sp-epoch-badges">
              {r.culled.map((s) => (
                <span key={s} className="sp-evt" data-kind="cull">
                  culled {s}
                </span>
              ))}
              {r.spawned.map((s) => (
                <span key={s} className="sp-evt" data-kind="spawn">
                  spawned {s}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
