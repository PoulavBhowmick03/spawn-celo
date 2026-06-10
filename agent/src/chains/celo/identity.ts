/**
 * ERC-8004 identity adapter for the canonical Celo registries (Phase 3).
 *
 * Interface verified against erc-8004/erc-8004-contracts (master):
 *   register(string agentURI) returns (uint256 agentId)
 *   event Registered(uint256 indexed agentId, string agentURI, address indexed owner)
 *   setAgentURI(uint256 agentId, string newURI)
 *
 * Design note: each agent registers ITSELF, so the identity NFT's owner is
 * the agent wallet — the ReputationRegistry blocks owner/operator
 * self-feedback, and the orchestrator (a different identity) must be able
 * to post performance feedback for agents.
 */

import { parseEventLogs, type Address, type Hex } from "viem";
import type { HDAccount } from "viem/accounts";
import { ERC8004, FEE_CURRENCIES, explorerTx } from "./addresses.js";
import { celoPublicClient, celoWalletClient } from "./chain.js";
import { assertTxAllowed } from "./budget.js";
import { logActivity } from "./activity-log.js";

export const IDENTITY_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "setAgentURI",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    name: "Registered",
    type: "event",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

/** Register `account` in the canonical Celo Identity Registry. Gas in cUSD. */
export async function registerIdentity(
  account: HDAccount,
  agentSlug: string,
  cardUrl: string,
): Promise<{ agentId: bigint; txHash: Hex }> {
  assertTxAllowed(0, `erc8004 register ${agentSlug} (moves no funds)`);
  const wallet = celoWalletClient(account);

  const txHash = await wallet.writeContract({
    address: ERC8004.IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "register",
    args: [cardUrl],
    feeCurrency: FEE_CURRENCIES.USDm,
  });
  const receipt = await celoPublicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`register reverted for ${agentSlug}: ${explorerTx(txHash)}`);
  }

  const events = parseEventLogs({
    abi: IDENTITY_REGISTRY_ABI,
    eventName: "Registered",
    logs: receipt.logs,
  });
  if (events.length === 0) throw new Error(`no Registered event for ${agentSlug}`);
  const agentId = events[0].args.agentId;

  logActivity({
    agentId: agentSlug,
    action: "erc8004-register",
    rationale:
      `Mint ERC-8004 identity #${agentId} for ${agentSlug} in the canonical Celo Identity ` +
      `Registry, owned by the agent's own wallet ${account.address} (self-owned so the ` +
      `orchestrator can post performance feedback — the registry forbids owner self-feedback). ` +
      `Agent card: ${cardUrl}. Gas paid in cUSD.`,
    txHash,
    erc8004AgentId: agentId.toString(),
    cardUrl,
  });

  return { agentId, txHash };
}

/** Read back owner + URI to verify a registration onchain (8004scan may lag). */
export async function verifyIdentity(agentId: bigint): Promise<{ owner: Address; uri: string }> {
  const [owner, uri] = await Promise.all([
    celoPublicClient.readContract({
      address: ERC8004.IDENTITY_REGISTRY,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    }),
    celoPublicClient.readContract({
      address: ERC8004.IDENTITY_REGISTRY,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "tokenURI",
      args: [agentId],
    }),
  ]);
  return { owner, uri };
}
