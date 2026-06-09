import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getWalletClient, publicClient } from "./chain.js";
import { LineageRegistryABI } from "./abis.js";
import type { TerminationPostMortem } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..");
const LOCAL_CID_DIR = join(REPO_ROOT, "runtime_ipfs");

function normalizeHexKey(key: string | undefined): `0x${string}` | null {
  if (!key) return null;
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

function lineageRegistryAddress(): `0x${string}` | null {
  const address = process.env.LINEAGE_REGISTRY_ADDRESS;
  if (!address || !address.startsWith("0x")) return null;
  return address as `0x${string}`;
}

function gatewayUrl(cid: string): string {
  const base = process.env.IPFS_GATEWAY_BASE || "https://gateway.pinata.cloud/ipfs";
  return `${base.replace(/\/$/, "")}/${cid}`;
}

async function fetchPostMortem(cid: string): Promise<TerminationPostMortem | null> {
  if (cid.startsWith("local:")) {
    const path = join(LOCAL_CID_DIR, `${cid.replace(/^local:/, "")}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as TerminationPostMortem;
    } catch {
      return null;
    }
  }

  try {
    const response = await fetch(gatewayUrl(cid), { method: "GET" });
    if (!response.ok) return null;
    return (await response.json()) as TerminationPostMortem;
  } catch {
    return null;
  }
}

export async function pushLineageCID(
  lineageKey: string,
  cid: string,
  privateKey?: `0x${string}`
): Promise<string | null> {
  const registry = lineageRegistryAddress();
  const signer = privateKey ?? normalizeHexKey(process.env.DEPLOYER_PRIVATE_KEY);
  if (!registry || !signer) return null;

  const walletClient = getWalletClient(signer);
  const hash = await walletClient.writeContract({
    address: registry,
    abi: LineageRegistryABI,
    functionName: "pushCID",
    args: [lineageKey, cid],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function postGenerationResult(
  lineageKey: string,
  veniceGeneratedSummary: string,
  avgYieldBps: number,
  agentsTerminated: number,
  generation: number,
  privateKey?: `0x${string}`
): Promise<string | null> {
  if (process.env.ALLOW_LIVE_GENERATION_POSTS !== "true") return null;

  const registry = lineageRegistryAddress();
  const signer = privateKey ?? normalizeHexKey(process.env.DEPLOYER_PRIVATE_KEY);
  if (!registry || !signer) return null;

  const walletClient = getWalletClient(signer);
  const hash = await walletClient.writeContract({
    address: registry,
    abi: LineageRegistryABI,
    functionName: "postGenerationResult",
    args: [
      lineageKey,
      veniceGeneratedSummary,
      BigInt(Math.max(0, Math.round(avgYieldBps))),
      BigInt(Math.max(0, Math.round(agentsTerminated))),
      BigInt(Math.max(0, Math.round(generation))),
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function getLineage(lineageKey: string): Promise<string[]> {
  const registry = lineageRegistryAddress();
  if (!registry) return [];

  try {
    return (await publicClient.readContract({
      address: registry,
      abi: LineageRegistryABI,
      functionName: "getLineage",
      args: [lineageKey],
    })) as string[];
  } catch {
    return [];
  }
}

// Reads the on-chain generation count for a lineage from the LineageRegistry.
// Returns null when the registry is unconfigured or the read fails, so callers can
// fall back to file-backed data rather than presenting a fabricated 0. (P2a)
export async function getOnChainGenerationCount(lineageKey: string): Promise<number | null> {
  const registry = lineageRegistryAddress();
  if (!registry) return null;

  try {
    const count = (await publicClient.readContract({
      address: registry,
      abi: LineageRegistryABI,
      functionName: "getGenerationCount",
      args: [lineageKey],
    })) as bigint;
    return Number(count);
  } catch {
    return null;
  }
}

export async function getLatestLineageCID(lineageKey: string): Promise<string | null> {
  const registry = lineageRegistryAddress();
  if (!registry) return null;

  try {
    return (await publicClient.readContract({
      address: registry,
      abi: LineageRegistryABI,
      functionName: "getLatestCID",
      args: [lineageKey],
    })) as string;
  } catch {
    return null;
  }
}

export async function buildAncestorContext(lineageKey: string): Promise<string> {
  const cids = await getLineage(lineageKey);
  if (cids.length === 0) {
    return [
      "Ancestor lineage context:",
      "No ancestor post-mortems are recorded for this lineage yet.",
    ].join("\n");
  }

  const postMortems = await Promise.all(cids.map((cid) => fetchPostMortem(cid)));
  const lines = ["Ancestor lineage context:"];

  cids.forEach((cid, index) => {
    const postMortem = postMortems[index];
    if (!postMortem) {
      lines.push(`Generation ${index + 1}: CID ${cid} could not be resolved. Do not assume missing context is safe.`);
      return;
    }

    lines.push(`Generation ${postMortem.generation}: ${postMortem.failureReason}`);
    lines.push(
      `  Final yield ${postMortem.metricsAtTermination.finalYieldPct.toFixed(4)}% vs benchmark ${postMortem.metricsAtTermination.benchmarkYieldPct.toFixed(4)}%; max drawdown ${postMortem.metricsAtTermination.maxDrawdownPct.toFixed(4)}%; risk-adjusted score ${postMortem.metricsAtTermination.riskAdjustedScore.toFixed(4)}.`
    );
    lines.push(`  Position at termination: ${postMortem.metricsAtTermination.positionSummary}`);
    if (postMortem.inheritanceConstraints.length > 0) {
      lines.push(`  Successor constraints: ${postMortem.inheritanceConstraints.join(" | ")}`);
    }
  });

  lines.push("You must internalize every ancestor failure and avoid repeating it.");
  return lines.join("\n");
}
