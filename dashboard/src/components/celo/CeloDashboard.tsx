"use client";

import type { ActivityEntry, EpochReport, SwarmState } from "@/lib/celo-data";
import { CONTRACTS, PAGES_BASE, REPO_URL, SCAN_8004, explorerAddress } from "@/lib/celo";
import { useSwarmLive } from "@/lib/celo-live";
import { OrbitalHero } from "./OrbitalHero";
import { AgentGrid } from "./AgentGrid";
import { EpochTimeline } from "./EpochTimeline";
import { ActivityFeed } from "./ActivityFeed";
import { Recompute } from "./Recompute";
import { agentValue } from "./util";

export function CeloDashboard(props: {
  initialState: SwarmState | null;
  initialActivity: ActivityEntry[];
  initialReports: EpochReport[];
}) {
  const { state, activity, reports } = useSwarmLive({
    state: props.initialState,
    activity: props.initialActivity,
    reports: props.initialReports,
  });

  const agents = state?.agents ?? [];
  const deployed = agents
    .filter((a) => a.status === "ACTIVE")
    .reduce((s, a) => s + agentValue(a), 0);

  return (
    <div className="sp">
      <main className="sp-shell">
        <header>
          <p className="sp-kicker">celo mainnet · live swarm · every tx has a published rationale</p>
          <div className="sp-mast">
            <h1>
              Spawn Protocol <span className="dim">— Hedge Swarm on Celo</span>
            </h1>
            <nav className="sp-extlinks">
              <a href={`${SCAN_8004}/agents?search=spawn`} target="_blank" rel="noreferrer">
                8004scan ↗
              </a>
              <a href={explorerAddress(CONTRACTS.TREASURY)} target="_blank" rel="noreferrer">
                treasury ↗
              </a>
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                source ↗
              </a>
              <a href={PAGES_BASE} target="_blank" rel="noreferrer">
                agent cards ↗
              </a>
            </nav>
          </div>
          <p className="sp-lede">
            A Darwinian swarm of ERC-8004 agents protecting stablecoin purchasing power: FX rotation
            across Mento stables and yield on Aave v3. Every epoch the fittest replicate with
            mutated parameters, the weakest are culled and their funds return to the treasury.{" "}
            <strong>None of these wallets has ever held CELO</strong> — gas is paid in the
            stablecoins they hold.
          </p>
        </header>

        {state ? (
          <OrbitalHero
            agents={agents}
            deployedUsd={deployed}
            epochNumber={state.epochNumber}
            lastSettleIso={reports[0]?.settledAt}
          />
        ) : (
          <div className="sp-orbital" style={{ padding: 48, textAlign: "center", color: "#8892A4" }}>
            swarm state not published yet — check{" "}
            <a href={REPO_URL} style={{ borderBottom: "1px solid #1A1A2E" }}>
              the repo
            </a>
          </div>
        )}

        <section className="sp-section">
          <h2>The swarm</h2>
          <p className="sub">
            Active agents first, ranked by fitness. Click a card for its epoch-by-epoch fitness
            history. Retired agents keep their identity and final reputation — honest history is
            part of the design.
          </p>
          <AgentGrid agents={agents} />
        </section>

        <section className="sp-section">
          <h2>Evolution, epoch by epoch</h2>
          <p className="sub">
            Each settle posts a reputation score per agent to the canonical ERC-8004 Reputation
            Registry, culls the bottom 20%, and spawns mutated descendants of the top performer.
            Chips link to each score&apos;s onchain reputation transaction.
          </p>
          <EpochTimeline reports={reports} agents={agents} />
        </section>

        <section className="sp-section" id="activity">
          <h2>Activity log — every action with its rationale</h2>
          <p className="sub">
            Raw file:{" "}
            <a href={`${REPO_URL}/blob/main/celo_activity.jsonl`} target="_blank" rel="noreferrer">
              celo_activity.jsonl ↗
            </a>{" "}
            — gold-bordered entries are x402 agent-to-agent payments.
          </p>
          <ActivityFeed activity={activity} agents={agents} />
        </section>

        <section className="sp-section">
          <h2>Verify everything yourself</h2>
          <p className="sub">
            The fitness formula is public and all of its inputs are onchain. Recompute any score
            from Celoscan data and compare it with what the orchestrator wrote to the Reputation
            Registry.
          </p>
          <Recompute />
        </section>
      </main>
    </div>
  );
}
