/**
 * Judge-facing epoch report (CLAUDE.md §9): tx list with rationales, fitness
 * table, links — printed as markdown and written to docs/epochs/.
 *
 *   npm run report:epoch            # latest settled epoch
 *   npm run report:epoch -- 2       # specific epoch
 */

import "./env.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXPLORER, SCAN_8004, explorerTx } from "./addresses.js";
import { loadState } from "./swarm-state.js";

const REPO_ROOT = resolve(process.cwd(), "..");
const DASHBOARD = "https://spawn-celo-swarm.vercel.app";

type ReportRow = {
  slug: string;
  erc8004AgentId: string;
  strategy: string;
  generation: number;
  vStartUsd: number;
  vEndUsd: number;
  gasUsd: number;
  netFlowUsd?: number;
  fitness: number;
  score: number;
  culled: boolean;
  reputationTx?: string;
};

function main() {
  const state = loadState();
  if (!state) throw new Error("no swarm state");
  const requested = Number(process.argv[2] ?? 0);
  const epoch = requested > 0 ? requested : state.epochNumber - 1; // latest settled
  const reportPath = resolve(REPO_ROOT, "docs", "epochs", `epoch-${epoch}.json`);
  if (!existsSync(reportPath)) throw new Error(`epoch ${epoch} not settled yet (no ${reportPath})`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));

  // activity entries inside the epoch window (settle of N-1 .. settle of N)
  const prevPath = resolve(REPO_ROOT, "docs", "epochs", `epoch-${epoch - 1}.json`);
  const windowStart = existsSync(prevPath)
    ? JSON.parse(readFileSync(prevPath, "utf8")).settledAt
    : "1970-01-01";
  const windowEnd = report.settledAt;
  const activity = readFileSync(resolve(REPO_ROOT, "celo_activity.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.timestamp > windowStart && e.timestamp <= windowEnd);

  const rows: ReportRow[] = report.agents;
  const lines: string[] = [];
  lines.push(`# Epoch ${epoch} report — Spawn Hedge Swarm on Celo`);
  lines.push("");
  lines.push(
    `Settled ${report.settledAt} · epoch length ${report.epochHours}h · swarm median fitness ${report.swarmMedianFitness.toFixed(4)}`,
  );
  lines.push(`Culled: ${report.culled.join(", ") || "none"} · Spawned: ${report.spawned.join(", ") || "none"}`);
  lines.push("");
  lines.push(
    "Fitness formula (recomputable from Celoscan): `fitness = ((V_end − net_flow)/V_start − 1)·(8760/epoch_h) − (gas/V_start)·(8760/epoch_h)`; `score = clamp(round(50 + 500·(fitness − median)), 0, 100)`. `net_flow` = orchestrator funding in/out during the epoch (capital movements, excluded from P&L); `epoch_h` = actual elapsed epoch length.",
  );
  lines.push("");
  lines.push("## Fitness table");
  lines.push("");
  lines.push("| agent | ERC-8004 | strategy | gen | V_start | V_end | net_flow | gas | fitness | score | culled | reputation tx |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(
      `| ${r.slug} | [#${r.erc8004AgentId}](${SCAN_8004}/agents/celo/${r.erc8004AgentId}) | ${r.strategy} | g${r.generation} | $${r.vStartUsd.toFixed(4)} | $${r.vEndUsd.toFixed(4)} | $${(r.netFlowUsd ?? 0).toFixed(4)} | $${r.gasUsd.toFixed(4)} | ${r.fitness.toFixed(4)} | ${r.score} | ${r.culled ? "**yes**" : ""} | ${r.reputationTx ? `[tx](${explorerTx(r.reputationTx)})` : "—"} |`,
    );
  }
  lines.push("");
  lines.push(`## Transactions with rationales (${activity.length} actions in window)`);
  lines.push("");
  for (const e of activity) {
    const tx = e.txHash ? ` — [tx](${explorerTx(e.txHash)})` : "";
    lines.push(`- \`${e.timestamp}\` **${e.agentId}** ${e.action}${tx}`);
    lines.push(`  ${e.rationale}`);
  }
  lines.push("");
  lines.push(
    `Links: [dashboard](${DASHBOARD}) · [8004scan](${SCAN_8004}/agents?search=spawn) · [explorer](${EXPLORER}) · raw data in this repo`,
  );

  const md = lines.join("\n") + "\n";
  const outPath = resolve(REPO_ROOT, "docs", "epochs", `epoch-${epoch}-report.md`);
  writeFileSync(outPath, md);
  console.log(md);
  console.error(`\n(written to ${outPath})`);
}

main();
