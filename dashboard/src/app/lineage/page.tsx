"use client";

import { Navbar } from "@/components/Navbar";
import { GenerationChart } from "@/components/GenerationChart";
import { useGenerationStats } from "@/hooks/useSwarmData";
import { formatPct } from "@/lib/mantle";

export default function LineagePage() {
  const { generations, loading, error, unavailable } = useGenerationStats();
  const first = generations[0];
  const latest = generations[generations.length - 1];

  return (
    <>
      <Navbar />
      <div className="dashboard-shell">
      <section className="rounded-[34px] border border-white/10 bg-[linear-gradient(135deg,rgba(120,255,225,0.12),rgba(8,17,31,0.95)_36%,rgba(5,10,19,0.98))] p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#b9fff2]/65">
          Ancestor Memory
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Lineage Performance</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-200/75">
          This view compresses the swarm into generation-level evidence: average yield, average
          risk-adjusted score, and whether successors are learning from lineage memory.
        </p>
      </section>

      {unavailable ? (
        <div className="rounded-[20px] border border-rose-400/40 bg-rose-500/15 px-4 py-4 text-sm text-rose-100 flex items-start gap-2 font-mono">
          <span className="mt-1 w-1.5 h-1.5 rounded-full bg-rose-400 inline-block" />
          <span>
            <strong className="uppercase tracking-[0.18em] text-rose-300">Control server unavailable</strong>
            <br />
            No live generation data. Showing no metrics rather than fabricated numbers
            {error ? ` (${error})` : ""}.
          </span>
        </div>
      ) : error ? (
        <div className="rounded-[28px] border border-rose-200/15 bg-rose-500/10 p-6 text-sm text-rose-100">
          Failed to load generation data: {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="metric-panel rounded-[26px] p-5">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Gen 1 Yield</div>
          <div className="mt-4 text-3xl font-semibold text-white">
            {first ? formatPct(first.avgYieldPct) : "—"}
          </div>
        </div>
        <div className="metric-panel rounded-[26px] p-5">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Latest Yield</div>
          <div className="mt-4 text-3xl font-semibold text-white">
            {latest ? formatPct(latest.avgYieldPct) : "—"}
          </div>
        </div>
        <div className="metric-panel rounded-[26px] p-5">
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Improvement</div>
          <div className="mt-4 text-3xl font-semibold text-white">
            {first && latest ? `${(latest.avgYieldPct - first.avgYieldPct).toFixed(2)} pts` : "—"}
          </div>
        </div>
      </section>

      <GenerationChart data={generations} />

      {!loading && generations.length > 0 ? (
        <section className="rounded-[28px] border border-white/10 bg-black/15 p-6 text-sm leading-7 text-slate-200/78">
          <strong className="text-white">Readout:</strong>{" "}
          {first && latest
            ? `Generation ${latest.generation} is ${latest.avgYieldPct >= first.avgYieldPct ? "ahead of" : "behind"} Generation 1 on average yield, while carrying an average risk-adjusted score of ${latest.avgRiskAdjustedScore.toFixed(2)}.`
            : "Waiting for enough swarm history to compare generations."}
        </section>
      ) : null}
      </div>
    </>
  );
}
