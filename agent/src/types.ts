export type ChildStatus = "ACTIVE" | "TERMINATED" | "RESPAWNING";

export type YieldAction =
  | "AAVE_SUPPLY_USDE" | "AAVE_SUPPLY_METH"
  | "AAVE_WITHDRAW_USDE" | "AAVE_WITHDRAW_METH"
  | "MOE_ADD_LIQUIDITY" | "MOE_REMOVE_LIQUIDITY"
  | "REBALANCE" | "HOLD";

export interface ChildState {
  pid: number;
  contractAddress: string;
  walletAddress: string;
  agentId: bigint;
  lineageKey: string;
  generation: number;
  spawnTime: number;
  cycleCount: number;
  currentYieldPct: number;
  benchmarkYieldPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  consecutiveBelowThreshold: number;
  positionSummary: string;
  status: ChildStatus;
  ipfsCid?: string;
  mantleSpawnTxHash: string;
  mantleRecallTxHash?: string;
}

export interface TerminationPostMortem {
  lineageKey: string;
  generation: number;
  agentContractAddress: string;
  agentWalletAddress: string;
  terminationTimestamp: number;
  cyclesLived: number;
  failureReason: string;
  metricsAtTermination: {
    finalYieldPct: number;
    benchmarkYieldPct: number;
    maxDrawdownPct: number;
    riskAdjustedScore: number;
    positionSummary: string;
  };
  inheritanceConstraints: string[];
  mantleRecallTxHash: string;
}

export interface ChildIPCReport {
  type: "YIELD_REPORT" | "ERROR";
  walletAddress: string;
  currentYieldPct: number;
  adjustedYieldPct?: number;
  drawdownPct: number;
  positionSummary: string;
  aaveSupplyUSDE: number;
  aaveSupplyMETH: number;
  moeLPValue: number;
  timestamp: number;
  numTradesLastEval: number;
  stdDevYieldLastEval: number;
  riskProfileModifier?: number;
  // True if any yield input this cycle came from the synthetic sine-wave fallback
  // (backtest/dry-run only) rather than a live Aave read. Never true in a live run. (P3a)
  yieldIsSimulated?: boolean;
  // False when Merchant Moe APY/position data could not be sourced from chain and was
  // excluded from yield math (rather than presented as a fake 0). (P3b)
  moeDataAvailable?: boolean;
}
