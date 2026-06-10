/**
 * Swarm state persistence — celo_swarm_state.json at the repo root.
 * Everything the epoch loop needs to resume after a restart, plus the data
 * the dashboard and report scripts read.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address, Hex } from "viem";
import type { StrategyId } from "./agents-config.js";
import type { FxLeg } from "./market.js";

export type SwarmAgentState = {
  slug: string;
  name: string;
  hdIndex: number;
  address: Address;
  erc8004AgentId: string;
  strategy: StrategyId;
  params: Record<string, number | boolean>;
  useSignal: boolean;
  generation: number;
  /** lineage root slug (gen-1 ancestor) */
  lineageKey: string;
  status: "ACTIVE" | "RETIRED";
  /** ChildAgent clone address from SpawnFactory.spawnChild */
  childContract?: Address;
  spawnTxHash?: Hex;
  recallTxHash?: Hex;
  /** cUSD portfolio value at the start of the current epoch */
  vStartUsd?: number;
  /** lifetime fitness history [epoch, fitness, score] */
  history: Array<{ epoch: number; fitness: number; score: number; vEndUsd: number; gasUsd: number }>;
};

export type SwarmState = {
  epochNumber: number;
  epochStartedAt?: string;
  nextHdIndex: number;
  /** last epoch's market snapshot inputs for momentum computation */
  prevFxUsdPrice?: Record<FxLeg, number>;
  agents: SwarmAgentState[];
};

const STATE_PATH = process.env.CELO_SWARM_STATE ?? resolve(process.cwd(), "..", "celo_swarm_state.json");

export function loadState(): SwarmState | undefined {
  if (!existsSync(STATE_PATH)) return undefined;
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}

export function saveState(state: SwarmState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

export const statePath = () => STATE_PATH;
