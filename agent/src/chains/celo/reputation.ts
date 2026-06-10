/**
 * Reputation writer (Phase 4): after every epoch the orchestrator posts one
 * giveFeedback() per agent to the canonical Celo ERC-8004 Reputation
 * Registry. The value is the bounded fitness-derived score (fitness.ts) —
 * performance attestation, recomputable by anyone, never wash reputation.
 *
 * Signature verified against erc-8004-contracts ReputationRegistryUpgradeable:
 *   giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals,
 *                string tag1, string tag2, string endpoint,
 *                string feedbackURI, bytes32 feedbackHash)
 * The registry forbids feedback from the agent's own owner/operators —
 * agents self-own their identities, the orchestrator is a distinct wallet.
 */

import { keccak256, toBytes, type Hex } from "viem";
import type { HDAccount } from "viem/accounts";
import { ERC8004, FEE_CURRENCIES, explorerTx } from "./addresses.js";
import { celoPublicClient, celoWalletClient } from "./chain.js";
import { assertTxAllowed } from "./budget.js";
import { logActivity } from "./activity-log.js";

const REPUTATION_ABI = [
  {
    name: "giveFeedback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "getSummary",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "clientAddresses", type: "address[]" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "summaryValue", type: "int128" },
      { name: "summaryValueDecimals", type: "uint8" },
    ],
  },
] as const;

export type EpochFeedback = {
  agentId: bigint;
  agentSlug: string;
  /** bounded 0-100 integer from reputationScore() */
  score: number;
  strategy: string;
  epochNumber: number;
  /** the recomputation inputs, embedded in the feedback hash + log */
  fitnessInputs: { vStartUsd: number; vEndUsd: number; gasUsd: number; epochHours: number };
  /** public URL where the epoch report lives */
  feedbackURI: string;
};

export async function postEpochFeedback(
  orchestrator: HDAccount,
  fb: EpochFeedback,
  /** false only in fork tests (anvil can't mine CIP-64 fee-currency txs) */
  liveFeeCurrency = true,
): Promise<Hex> {
  if (!Number.isInteger(fb.score) || fb.score < 0 || fb.score > 100) {
    throw new Error(`score out of bounds: ${fb.score}`);
  }
  assertTxAllowed(0, `reputation feedback for ${fb.agentSlug} (moves no funds)`);

  const payload = JSON.stringify({
    epoch: fb.epochNumber,
    agentId: fb.agentId.toString(),
    score: fb.score,
    inputs: fb.fitnessInputs,
    formula:
      "fitness=annualize(V_end/V_start)-gas_penalty; score=clamp(round(50+500*(fitness-median)),0,100)",
  });
  const feedbackHash = keccak256(toBytes(payload));

  const wallet = celoWalletClient(orchestrator);
  const txHash = await wallet.writeContract({
    address: ERC8004.REPUTATION_REGISTRY,
    abi: REPUTATION_ABI,
    functionName: "giveFeedback",
    args: [
      fb.agentId,
      BigInt(fb.score),
      0,
      "epoch-fitness",
      fb.strategy,
      "",
      fb.feedbackURI,
      feedbackHash,
    ],
    feeCurrency: liveFeeCurrency ? FEE_CURRENCIES.USDm : undefined,
  });
  const receipt = await celoPublicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`giveFeedback reverted for ${fb.agentSlug}: ${explorerTx(txHash)}`);
  }

  logActivity({
    agentId: "orchestrator",
    action: "reputation-feedback",
    rationale:
      `Epoch ${fb.epochNumber} performance attestation for ${fb.agentSlug} (ERC-8004 #${fb.agentId}): ` +
      `score ${fb.score}/100 from the published fitness formula with inputs ` +
      `V_start=$${fb.fitnessInputs.vStartUsd.toFixed(4)}, V_end=$${fb.fitnessInputs.vEndUsd.toFixed(4)}, ` +
      `gas=$${fb.fitnessInputs.gasUsd.toFixed(4)} over ${fb.fitnessInputs.epochHours}h — all reconstructible ` +
      `from Celoscan. feedbackHash=keccak(payload) binds this exact computation.`,
    txHash,
    erc8004AgentId: fb.agentId.toString(),
    score: fb.score,
    feedbackHash,
    payload,
  });
  return txHash;
}

/** Read back the orchestrator's posted feedback for an agent. */
export async function readReputationSummary(
  agentId: bigint,
  orchestratorAddress: `0x${string}`,
): Promise<{ count: bigint; value: bigint; decimals: number }> {
  const [count, summaryValue, summaryValueDecimals] = await celoPublicClient.readContract({
    address: ERC8004.REPUTATION_REGISTRY,
    abi: REPUTATION_ABI,
    functionName: "getSummary",
    args: [agentId, [orchestratorAddress], "", ""],
  });
  return { count: BigInt(count), value: summaryValue, decimals: summaryValueDecimals };
}
