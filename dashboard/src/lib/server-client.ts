import { createPublicClient, defineChain, http, fallback } from "viem";

// Mantle mainnet (chain 5000) — the live chain the whole UI targets.
const MANTLE_RPC_URLS = [
  process.env.MANTLE_RPC_URL || process.env.NEXT_PUBLIC_MANTLE_RPC_URL || "https://rpc.mantle.xyz",
  "https://mantle-rpc.publicnode.com",
  "https://mantle.drpc.org",
];

const mantle = defineChain({
  id: 5000,
  name: "Mantle",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: MANTLE_RPC_URLS } },
  blockExplorers: { default: { name: "Mantlescan", url: "https://mantlescan.xyz" } },
});

// Server-side viem client — shared across API routes. Mantle (chain 5000), NOT Base Sepolia.
export const serverClient = createPublicClient({
  chain: mantle,
  transport: fallback(MANTLE_RPC_URLS.map((url) => http(url))),
  ccipRead: false,
  batch: { multicall: true },
});

// Simple in-memory cache with TTL
const cache = new Map<string, { data: any; expiresAt: number }>();

export function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setCache(key: string, data: any, ttlMs: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}
