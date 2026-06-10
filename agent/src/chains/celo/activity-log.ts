/**
 * Judge-facing activity log (CLAUDE.md §3.1): every onchain action gets one
 * JSONL line with a human-readable rationale. Append-only file at the repo
 * root so the dashboard and report scripts can serve it verbatim.
 */

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

const LOG_PATH =
  process.env.CELO_ACTIVITY_LOG ??
  resolve(process.cwd(), "..", "celo_activity.jsonl");

type ActivityFields = {
  timestamp: string; // ISO-8601
  agentId: string; // "orchestrator" | "agent-N" | erc8004 id once registered
  action: string; // e.g. "feecurrency-smoke-transfer", "mento-swap"
  rationale: string; // human-readable why, judge-facing
  txHash?: `0x${string}`;
  chain: "celo";
};
export type ActivityEntry = ActivityFields & Record<string, unknown>;

export function logActivity(
  entry: Omit<ActivityFields, "timestamp" | "chain"> & Record<string, unknown>,
): ActivityEntry {
  const full: ActivityEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    chain: "celo",
  };
  appendFileSync(LOG_PATH, JSON.stringify(full) + "\n");
  return full;
}

export const activityLogPath = () => LOG_PATH;
