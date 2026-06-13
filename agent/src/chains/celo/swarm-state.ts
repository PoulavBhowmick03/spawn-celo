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
  /** set when an external sponsor funded this agent (not the developer budget) */
  patron?: { depositor: Address; depositTx: Hex; amountUsd: number };
  /** cUSD portfolio value at the start of the current epoch */
  vStartUsd?: number;
  /** gas paid during the open epoch, in cUSD (fitness penalty input) */
  epochGasUsd?: number;
  /** net external flows (orchestrator deposits − sweeps) during the open
   *  epoch, in cUSD — excluded from fitness P&L (capital, not performance) */
  epochFlowUsd?: number;
  /** lifetime fitness history [epoch, fitness, score] */
  history: Array<{
    epoch: number;
    fitness: number;
    score: number;
    vEndUsd: number;
    gasUsd: number;
    netFlowUsd?: number;
    epochHours?: number;
  }>;
};

export type PendingSpawn = {
  slug: string;
  name: string;
  hdIndex: number;
  strategy: StrategyId;
  params: Record<string, number | boolean>;
  useSignal: boolean;
  generation: number;
  lineageKey: string;
  fundUsd: number;
  description: string;
  /** set for externally-sponsored agents (funded by a patron deposit) */
  patron?: { depositor: Address; depositTx: Hex; amountUsd: number };
};

export type SwarmState = {
  epochNumber: number;
  epochStartedAt?: string;
  nextHdIndex: number;
  /** epoch whose cull already ran (resume safety — never cull twice) */
  lastCulledEpoch?: number;
  /** epoch whose growth spawn already enqueued (resume safety — a crash
   *  mid-settle must not enqueue a second growth spawn on re-entry) */
  lastGrowthEpoch?: number;
  /** block from which to scan for external patron cUSD deposits to the
   *  treasury — initialized to the block at first run so historical
   *  setup/Mento transfers are never misread as sponsorships */
  patronScanFromBlock?: string;
  /** cUSD deposit txs already converted to patron spawns (dedupe) */
  processedDeposits?: string[];
  /** cumulative external capital contributed by sponsors, in cUSD — additive
   *  to and tracked separately from the developer's $50 budget */
  patronCapitalUsd?: number;
  /** spawns enqueued by a cull but not yet completed (retried each cycle) */
  pendingSpawns?: PendingSpawn[];
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
