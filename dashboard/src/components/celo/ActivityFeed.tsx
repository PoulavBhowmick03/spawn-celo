"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEntry, SwarmAgent } from "@/lib/celo-data";
import { explorerTx } from "@/lib/celo";
import { LocalTime } from "@/components/LocalTime";
import { actionStyle, isX402Action, stratColor } from "./util";

const PAGE = 100;

export function ActivityFeed({
  activity,
  agents,
}: {
  activity: ActivityEntry[];
  agents: SwarmAgent[];
}) {
  const [visible, setVisible] = useState(PAGE);
  const [showJump, setShowJump] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const hoveringRef = useRef(false);

  const strategyOf = useMemo(() => {
    const m = new Map(agents.map((a) => [a.slug, a.strategy]));
    return (id: string) => m.get(id);
  }, [agents]);

  const now = Date.now();
  const entries = activity.slice(0, visible);

  const onScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    setShowJump(el.scrollTop > 200);
  };

  const jumpToLatest = () => {
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  // when fresh entries arrive and the user is at the top (and not reading),
  // stay pinned to the top — entries animate in there
  useEffect(() => {
    const el = feedRef.current;
    if (el && !hoveringRef.current && el.scrollTop < 40) el.scrollTop = 0;
  }, [activity]);

  return (
    <div className="sp-feed-wrap">
      <div
        className="sp-feed"
        ref={feedRef}
        onScroll={onScroll}
        onPointerEnter={() => (hoveringRef.current = true)}
        onPointerLeave={() => (hoveringRef.current = false)}
      >
        {entries.map((e, i) => {
          const t = new Date(e.timestamp).getTime();
          const fresh = now - t < 60_000;
          const x402 = isX402Action(e.action);
          const style = actionStyle(e.action);
          const strat = strategyOf(e.agentId);
          return (
            <div
              key={`${e.timestamp}-${e.txHash ?? i}`}
              className="sp-entry"
              data-fresh={fresh || undefined}
              data-x402={x402 || undefined}
            >
              <div className="sp-entry-ts">
                <LocalTime iso={e.timestamp} />
              </div>
              <div className="sp-entry-main">
                <div className="sp-entry-line">
                  <span
                    className="sp-entry-agent"
                    style={strat ? { color: stratColor(strat) } : undefined}
                  >
                    {e.agentId}
                  </span>
                  <span className="sp-action" style={{ background: style.bg, color: style.color }}>
                    {e.action}
                  </span>
                  {e.txHash && (
                    <a
                      className="sp-entry-tx"
                      href={explorerTx(e.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      title={e.txHash}
                    >
                      tx ↗
                    </a>
                  )}
                </div>
                <div className="sp-rationale">{e.rationale}</div>
              </div>
            </div>
          );
        })}
        {visible < activity.length && (
          <button className="sp-loadmore" onClick={() => setVisible((v) => v + PAGE)}>
            load {Math.min(PAGE, activity.length - visible)} older entries
          </button>
        )}
        {activity.length === 0 && (
          <p style={{ padding: 18, color: "#8892A4" }}>no activity published yet</p>
        )}
      </div>
      {showJump && (
        <button className="sp-jump" onClick={jumpToLatest}>
          ↑ jump to latest
        </button>
      )}
    </div>
  );
}
