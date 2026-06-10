import {
  CONTRACTS,
  PAGES_BASE,
  REPO_URL,
  SCAN_8004,
  explorerAddress,
  explorerTx,
  scanAgent,
} from "@/lib/celo";
import {
  fetchActivity,
  fetchEpochReports,
  fetchSwarmState,
  type SwarmAgent,
} from "@/lib/celo-data";
import { CeloAutoRefresh } from "@/components/CeloAutoRefresh";

export const revalidate = 60;

function fmtUsd(n?: number) {
  return n === undefined ? "—" : `$${n.toFixed(3)}`;
}

function lastOf(agent: SwarmAgent) {
  return agent.history[agent.history.length - 1];
}

function StatusPill({ status }: { status: SwarmAgent["status"] }) {
  return (
    <span
      className={
        status === "ACTIVE"
          ? "rounded px-1.5 py-0.5 text-xs font-semibold bg-emerald-500/15 text-emerald-500"
          : "rounded px-1.5 py-0.5 text-xs font-semibold bg-zinc-500/15 text-zinc-400"
      }
    >
      {status}
    </span>
  );
}

export default async function Home() {
  const [state, activity] = await Promise.all([fetchSwarmState(), fetchActivity(120)]);
  const reports = state ? await fetchEpochReports(state.epochNumber) : [];

  const agents = state?.agents ?? [];
  const active = agents.filter((a) => a.status === "ACTIVE");
  const retired = agents.filter((a) => a.status === "RETIRED");
  const deployed = active.reduce((s, a) => s + (lastOf(a)?.vEndUsd ?? a.vStartUsd ?? 0), 0);
  const maxGen = Math.max(1, ...agents.map((a) => a.generation));
  const lastReport = reports[0];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 space-y-10">
      <CeloAutoRefresh />

      {/* hero */}
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-widest opacity-60">
          Celo Mainnet · live swarm · every tx has a published rationale
        </p>
        <h1 className="text-3xl font-bold" style={{ fontFamily: "var(--display)" }}>
          Spawn Protocol — Hedge Swarm on Celo
        </h1>
        <p className="max-w-3xl opacity-80">
          A Darwinian swarm of ERC-8004 agents protecting stablecoin purchasing power: FX
          rotation across Mento stables (cUSD/cEUR/cREAL) and yield on Aave v3. Every epoch the
          fittest replicate with mutated parameters, the weakest are culled and their funds
          return to the treasury. Agents pay gas in the stablecoins they hold — none of these
          wallets has ever held CELO.
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          {[
            ["epoch", state ? `#${state.epochNumber}` : "—"],
            ["active agents", String(active.length)],
            ["retired", String(retired.length)],
            ["deployed", `$${deployed.toFixed(2)}`],
            ["max generation", `g${maxGen}`],
            ["last settle", lastReport ? new Date(lastReport.settledAt).toUTCString().slice(5, 22) : "epoch 1 open"],
          ].map(([k, v]) => (
            <span key={k} className="rounded border border-zinc-500/30 px-2 py-1">
              <span className="opacity-60">{k}</span> <strong>{v}</strong>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <a href={`${SCAN_8004}/agents?search=spawn`} target="_blank" rel="noreferrer">
            8004scan ↗
          </a>
          <a href={explorerAddress(CONTRACTS.TREASURY)} target="_blank" rel="noreferrer">
            treasury on Celoscan ↗
          </a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            source + raw data ↗
          </a>
          <a href={PAGES_BASE} target="_blank" rel="noreferrer">
            agent cards ↗
          </a>
        </div>
      </header>

      {/* swarm table */}
      <section className="space-y-2">
        <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--display)" }}>
          The swarm
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left opacity-60">
              <tr>
                <th className="py-1 pr-3">agent</th>
                <th className="py-1 pr-3">strategy</th>
                <th className="py-1 pr-3">gen</th>
                <th className="py-1 pr-3">status</th>
                <th className="py-1 pr-3">value</th>
                <th className="py-1 pr-3">fitness</th>
                <th className="py-1 pr-3">score</th>
                <th className="py-1 pr-3">links</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const last = lastOf(a);
                return (
                  <tr key={a.slug} className="border-t border-zinc-500/20">
                    <td className="py-1.5 pr-3 font-medium">{a.slug}</td>
                    <td className="py-1.5 pr-3">{a.strategy}</td>
                    <td className="py-1.5 pr-3">g{a.generation}</td>
                    <td className="py-1.5 pr-3">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="py-1.5 pr-3">{fmtUsd(last?.vEndUsd ?? a.vStartUsd)}</td>
                    <td className="py-1.5 pr-3">{last ? last.fitness.toFixed(3) : "—"}</td>
                    <td className="py-1.5 pr-3">{last ? `${last.score}/100` : "—"}</td>
                    <td className="py-1.5 pr-3 space-x-2 whitespace-nowrap">
                      <a href={scanAgent(a.erc8004AgentId)} target="_blank" rel="noreferrer">
                        8004 #{a.erc8004AgentId}
                      </a>
                      <a href={explorerAddress(a.address)} target="_blank" rel="noreferrer">
                        wallet
                      </a>
                      {a.recallTxHash && (
                        <a href={explorerTx(a.recallTxHash)} target="_blank" rel="noreferrer">
                          recall
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
              {agents.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 opacity-60">
                    swarm state not published yet — check {REPO_URL}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* evolution */}
      <section className="space-y-2">
        <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--display)" }}>
          Evolution, epoch by epoch
        </h2>
        <p className="text-sm opacity-70">
          Each settle posts a reputation score per agent to the canonical ERC-8004 Reputation
          Registry, culls the bottom 20%, and spawns mutated descendants of the top performer.
        </p>
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.epoch} className="rounded border border-zinc-500/25 p-3 text-sm">
              <div className="flex flex-wrap gap-3 items-baseline">
                <strong>epoch {r.epoch}</strong>
                <span className="opacity-60">
                  settled {new Date(r.settledAt).toUTCString().slice(5, 25)} · median fitness{" "}
                  {r.swarmMedianFitness.toFixed(3)}
                </span>
                {r.culled.map((s) => (
                  <span key={s} className="rounded bg-red-500/15 text-red-400 px-1.5 py-0.5 text-xs">
                    culled {s}
                  </span>
                ))}
                {r.spawned.map((s) => (
                  <span key={s} className="rounded bg-emerald-500/15 text-emerald-500 px-1.5 py-0.5 text-xs">
                    spawned {s}
                  </span>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.agents.map((a) => (
                  <span
                    key={a.slug}
                    title={`V ${a.vStartUsd.toFixed(3)} → ${a.vEndUsd.toFixed(3)}, gas $${a.gasUsd.toFixed(4)}, fitness ${a.fitness.toFixed(3)}`}
                    className="rounded border border-zinc-500/25 px-1.5 py-0.5 text-xs"
                  >
                    {a.slug}: {a.score}
                    {a.reputationTx && (
                      <>
                        {" "}
                        <a href={explorerTx(a.reputationTx)} target="_blank" rel="noreferrer">
                          tx↗
                        </a>
                      </>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {reports.length === 0 && (
            <p className="text-sm opacity-60">first epoch not settled yet</p>
          )}
        </div>
      </section>

      {/* activity log */}
      <section id="activity" className="space-y-2">
        <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--display)" }}>
          Activity log — the judge-facing layer
        </h2>
        <p className="text-sm opacity-70">
          Every onchain action, paired with the rationale that produced it. Raw file:{" "}
          <a href={`${REPO_URL}/blob/main/celo_activity.jsonl`} target="_blank" rel="noreferrer">
            celo_activity.jsonl ↗
          </a>
        </p>
        <div className="space-y-2 max-h-[32rem] overflow-y-auto rounded border border-zinc-500/25 p-3">
          {activity.map((e, i) => (
            <div key={`${e.timestamp}-${i}`} className="text-xs leading-relaxed border-b border-zinc-500/10 pb-2">
              <span className="opacity-50">{e.timestamp.replace("T", " ").slice(0, 19)}Z</span>{" "}
              <strong>{e.agentId}</strong>{" "}
              <span className="rounded bg-blue-500/10 text-blue-400 px-1">{e.action}</span>{" "}
              {e.txHash && (
                <a href={explorerTx(e.txHash)} target="_blank" rel="noreferrer">
                  tx↗
                </a>
              )}
              <div className="opacity-80 mt-0.5">{e.rationale}</div>
            </div>
          ))}
          {activity.length === 0 && <p className="opacity-60 text-sm">no activity published yet</p>}
        </div>
      </section>

      {/* verify it yourself */}
      <section className="space-y-2 text-sm">
        <h2 className="text-xl font-semibold" style={{ fontFamily: "var(--display)" }}>
          Recompute everything yourself
        </h2>
        <pre className="rounded border border-zinc-500/25 p-3 overflow-x-auto text-xs">
{`fitness(agent, epoch) = (V_end / V_start − 1) × (8760 / epoch_hours) − gas_penalty
gas_penalty           = (gas_paid_cUSD / V_start) × (8760 / epoch_hours)
reputation_score      = clamp(round(50 + 500 × (fitness − swarm_median)), 0, 100)

V = portfolio marked in cUSD via Mento quotes; every input readable on Celoscan.`}
        </pre>
        <ul className="grid gap-1 sm:grid-cols-2">
          {Object.entries(CONTRACTS).map(([name, addr]) => (
            <li key={name}>
              <span className="opacity-60">{name}</span>{" "}
              <a href={explorerAddress(addr)} target="_blank" rel="noreferrer">
                {addr.slice(0, 10)}…{addr.slice(-6)} ↗
              </a>
            </li>
          ))}
        </ul>
        <p className="opacity-60">
          Hackathon-grade software handling real but small funds ($50 cap, $5/agent, 1% slippage,
          kill switch — all enforced in code). Do not deposit money you care about.
        </p>
      </section>
    </main>
  );
}
