import { createPublicClient, defineChain, http } from "viem";
import type { ChildState, GenerationStat, SwarmEvent } from "@/types";
export type SwarmChildState = ChildState;
export type GenerationStats = GenerationStat;
export type { ChildState, GenerationStat, SwarmEvent };

export const MANTLE_EXPLORER_BASE = "https://mantlescan.xyz";
export const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787").replace(/\/$/, "");

export const MANTLE_RPC_URL =
  process.env.NEXT_PUBLIC_MANTLE_RPC_URL || "https://rpc.mantle.xyz";

export const CONTRACT_LINKS = {
  spawnFactory:
    process.env.NEXT_PUBLIC_SPAWN_FACTORY_ADDRESS ||
    "0x94171e5D54792149E14fFa19197e3c17E263C740",
  lineageRegistry:
    process.env.NEXT_PUBLIC_LINEAGE_REGISTRY_ADDRESS ||
    "0x0466c58d7955cFdfa9E2070077D2f5E26561b59E",
  // ERC-8004 identity/reputation registries have ZERO bytecode on Mantle (see AUDIT.md
  // Phase 0/4). Intentionally left empty: no component should present these as live.
  erc8004Registry: process.env.NEXT_PUBLIC_ERC8004_IDENTITY_REGISTRY || "",
};

// ─── Shared Mantle (chain 5000) read client + LineageRegistry reader ──────────
// Same on-chain read path the /community page uses (LineageRegistry.getLineage).

export const mantleChain = defineChain({
  id: 5000,
  name: "Mantle",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: [MANTLE_RPC_URL] } },
  blockExplorers: { default: { name: "Mantlescan", url: MANTLE_EXPLORER_BASE } },
});

export const mantlePublicClient = createPublicClient({
  chain: mantleChain,
  transport: http(MANTLE_RPC_URL),
});

const lineageRegistryAbi = [
  {
    type: "function",
    name: "getLineage",
    inputs: [{ name: "lineageKey", type: "string" }],
    outputs: [{ name: "", type: "string[]" }],
    stateMutability: "view",
  },
] as const;

/**
 * Reads the on-chain ancestor CID chain for a lineage key from LineageRegistry.
 * Returns the ordered list of post-mortem IPFS CIDs (oldest → newest), or throws.
 */
export async function getLineage(lineageKey: string): Promise<string[]> {
  const address = CONTRACT_LINKS.lineageRegistry as `0x${string}`;
  const cids = await mantlePublicClient.readContract({
    address,
    abi: lineageRegistryAbi,
    functionName: "getLineage",
    args: [lineageKey],
  });
  return [...cids];
}

export function explorerTx(hash?: string | null) {
  if (!hash) return "";
  return `${MANTLE_EXPLORER_BASE}/tx/${hash}`;
}

export function explorerAddress(address?: string | null) {
  if (!address) return "";
  return `${MANTLE_EXPLORER_BASE}/address/${address}`;
}

export function ipfsUrl(cid?: string | null) {
  if (!cid) return "";
  if (cid.startsWith("local:")) return "";
  return `https://gateway.pinata.cloud/ipfs/${cid}`;
}

export function formatAddress(value?: string | null) {
  if (!value) return "Unavailable";
  if (value.length < 10) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function formatPct(value: number) {
  return `${value.toFixed(2)}%`;
}

export function formatTime(value: string | number) {
  return new Date(value).toLocaleString();
}

export function childLabel(child: SwarmChildState) {
  return `${child.lineageKey}-v${child.generation}`;
}
