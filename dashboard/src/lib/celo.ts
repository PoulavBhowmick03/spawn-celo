/**
 * Celo mainnet config for the Hedge Swarm dashboard (Phase 5).
 * Addresses mirror agent/src/chains/celo/addresses.ts (triple-verified there).
 */

import { createPublicClient, http, fallback } from "viem";
import { celo } from "viem/chains";

export const CELO_EXPLORER = "https://celoscan.io";
export const SCAN_8004 = "https://www.8004scan.io";
export const REPO_URL = "https://github.com/PoulavBhowmick03/spawn-celo";
export const RAW_BASE = "https://raw.githubusercontent.com/PoulavBhowmick03/spawn-celo/main";
export const PAGES_BASE = "https://poulavbhowmick03.github.io/spawn-celo";

const RPC_URLS = [
  process.env.NEXT_PUBLIC_CELO_RPC_URL ?? "https://forno.celo.org",
  "https://celo-rpc.publicnode.com",
];

export const celoPublicClient = createPublicClient({
  chain: celo,
  transport: fallback(RPC_URLS.map((u) => http(u))),
});

export const CONTRACTS = {
  SPAWN_FACTORY: "0x670C3Ad2Bc91fBd07720BFbFB7F0F2AF3e3ad85d",
  CHILD_AGENT_IMPL: "0xd6ac7fee72a4fC9a96aE2B44E17d318666cb23d3",
  LINEAGE_REGISTRY: "0x620C51De11E5B3d0F8B5E4439595B70495B18e85",
  ERC8004_IDENTITY: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  ERC8004_REPUTATION: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  MENTO_BROKER: "0x777A8255cA72412f0d706dc03C9D1987306B4CaD",
  AAVE_POOL: "0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402",
  TREASURY: "0xC0296012Cfbb0e6DF5dA7158B65Dbc46DD9650e0",
} as const;

/** Celo mainnet chain id + cUSD (USDm) token — used by the sponsor flow. */
export const CELO_CHAIN_ID = 42220;
export const CUSD_ADDRESS = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as const;
/** Smallest sponsorship that spawns an agent (mirrors agent MIN_PATRON_USD). */
export const MIN_SPONSOR_USD = 1;

export const explorerTx = (hash: string) => `${CELO_EXPLORER}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${CELO_EXPLORER}/address/${addr}`;
export const scanAgent = (agentId: string | number) => `${SCAN_8004}/agents/celo/${agentId}`;
