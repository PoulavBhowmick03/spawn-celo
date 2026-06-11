/**
 * Judge-facing verifier: independently recompute every agent's fitness and
 * reputation score for a settled epoch from the published report inputs,
 * then verify the onchain giveFeedback calldata (score + feedbackHash)
 * matches. Read-only — proves the "recomputable by anyone" claim.
 *
 *   npm run verify:reputation            # latest settled epoch
 *   npm run verify:reputation -- 5       # specific epoch
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, toBytes, decodeFunctionData, parseAbi, type Hex } from "viem";
import { celoPublicClient } from "./chain.js";
import { loadState } from "./swarm-state.js";

const ABI = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);
const REPO_ROOT = resolve(process.cwd(), "..");

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const state = loadState();
  const epoch = Number(process.argv[2] ?? 0) || (state ? state.epochNumber - 1 : NaN);
  const reportPath = resolve(REPO_ROOT, "docs", "epochs", `epoch-${epoch}.json`);
  if (!existsSync(reportPath)) throw new Error(`no report for epoch ${epoch} (${reportPath})`);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const swarmMedian = median(report.agents.map((a: { fitness: number }) => a.fitness));

  // payloads as logged: every reputation-feedback entry embeds the exact
  // hashed payload, so the binding is checkable without trusting this repo
  const logged: Record<string, { payload: string; feedbackHash: Hex; txHash: Hex }> = {};
  for (const line of readFileSync(resolve(REPO_ROOT, "celo_activity.jsonl"), "utf8").trim().split("\n")) {
    let e: { action?: string; payload?: string; feedbackHash?: Hex; txHash?: Hex };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.action === "reputation-feedback" && e.payload) {
      const p = JSON.parse(e.payload);
      if (p.epoch === epoch) logged[p.agentId] = { payload: e.payload, feedbackHash: e.feedbackHash!, txHash: e.txHash! };
    }
  }

  let failures = 0;
  for (const r of report.agents) {
    // 1. independent arithmetic from the published inputs
    const hours = r.epochHours ?? report.epochHours;
    const per = 8760 / hours;
    const fit = ((r.vEndUsd - (r.netFlowUsd ?? 0)) / r.vStartUsd - 1) * per - (r.gasUsd / r.vStartUsd) * per;
    const score = Math.min(100, Math.max(0, Math.round(50 + 500 * (fit - swarmMedian))));
    const fitOk = Math.abs(fit - r.fitness) < 1e-6 && score === r.score;

    // 2. the logged payload must hash to the logged feedbackHash
    const L = logged[r.erc8004AgentId];
    const hashOk = !!L && keccak256(toBytes(L.payload)) === L.feedbackHash;

    // 3. the onchain calldata must carry the same score and hash
    let chainOk = false;
    if (L) {
      const tx = await celoPublicClient.getTransaction({ hash: L.txHash });
      const d = decodeFunctionData({ abi: ABI, data: tx.input });
      const [agentId, value, , , , , , chainHash] = d.args;
      chainOk = agentId.toString() === r.erc8004AgentId && Number(value) === r.score && chainHash === L.feedbackHash;
    }

    const ok = fitOk && hashOk && chainOk;
    if (!ok) failures++;
    console.log(
      `${ok ? "✓" : "✗"} ${r.slug} (#${r.erc8004AgentId}): fitness ${fit.toFixed(4)} vs published ${r.fitness.toFixed(4)} | score ${score} vs ${r.score} | payload-hash ${hashOk ? "ok" : "MISMATCH"} | onchain ${chainOk ? "ok" : "MISMATCH"}${L ? ` | tx ${L.txHash.slice(0, 14)}…` : " | no logged feedback"}`,
    );
  }
  console.log(`\nepoch ${epoch}: median ${swarmMedian.toFixed(6)}, ${report.agents.length - failures}/${report.agents.length} fully verified`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
