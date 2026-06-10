/**
 * Generates ERC-8004 agent cards (registration-v1 JSON) into docs/agents/,
 * served by GitHub Pages from the spawn-celo repo. Idempotent: re-run after
 * registration to embed the minted agentIds (the URL never changes, so no
 * setAgentURI is needed).
 *
 *   npm run cards:celo
 */

import "./env.js";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ERC8004, EXPLORER, SCAN_8004 } from "./addresses.js";
import { ORCHESTRATOR_SPEC, SWARM_AGENTS, type AgentSpec } from "./agents-config.js";
import { deriveAccount } from "./wallets.js";

export const PAGES_BASE = "https://poulavbhowmick03.github.io/spawn-celo";
export const REPO_URL = "https://github.com/PoulavBhowmick03/spawn-celo";

const DOCS_DIR = resolve(process.cwd(), "..", "docs");
const AGENTS_DIR = resolve(DOCS_DIR, "agents");
const REGISTRY_PATH = resolve(AGENTS_DIR, "registry.json");

export type RegistryFile = Record<
  string,
  { agentId: string; address: string; txHash: string }
>;

export function loadRegistry(): RegistryFile {
  if (!existsSync(REGISTRY_PATH)) return {};
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
}

export function cardUrl(slug: string): string {
  return `${PAGES_BASE}/agents/${slug}.json`;
}

function buildCard(
  spec: { slug: string; name: string; description: string } & Partial<AgentSpec>,
  registry: RegistryFile,
) {
  const address = deriveAccount(spec.hdIndex ?? 0).address;
  const reg = registry[spec.slug];
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: spec.name,
    description: spec.description,
    services: [
      { name: "activity-log", endpoint: `${REPO_URL}/blob/main/celo_activity.jsonl` },
      { name: "source", endpoint: REPO_URL },
    ],
    x402Support: false,
    active: true,
    registrations: reg
      ? [
          {
            agentId: Number(reg.agentId),
            agentRegistry: `eip155:42220:${ERC8004.IDENTITY_REGISTRY}`,
          },
        ]
      : [],
    supportedTrust: ["reputation"],
    // --- spawn-protocol extensions (informative, judge-facing) ---
    spawn: {
      role: spec.hdIndex === 0 ? "orchestrator" : "swarm-agent",
      wallet: address,
      strategy: spec.strategy ?? null,
      params: spec.params ?? null,
      buysX402Signals: spec.useSignal ?? false,
      fitnessFormula:
        "fitness = annualize(V_end/V_start) - gas_penalty; reputation = clamp(round(50 + 500*(fitness - swarm_median)), 0, 100); inputs recomputable from Celoscan",
      explorer: `${EXPLORER}/address/${address}`,
      scan8004: `${SCAN_8004}/agents/celo`,
    },
  };
}

export function generateAllCards(): string[] {
  mkdirSync(AGENTS_DIR, { recursive: true });
  const registry = loadRegistry();
  const written: string[] = [];

  const all = [ORCHESTRATOR_SPEC, ...SWARM_AGENTS];
  for (const spec of all) {
    const card = buildCard(spec, registry);
    const path = resolve(AGENTS_DIR, `${spec.slug}.json`);
    writeFileSync(path, JSON.stringify(card, null, 2) + "\n");
    written.push(path);
  }

  const index = `<!doctype html><meta charset="utf-8"><title>Spawn Hedge Swarm — Celo agents</title>
<h1>Spawn Hedge Swarm — ERC-8004 agent cards (Celo mainnet)</h1>
<p>Identity Registry: <code>${ERC8004.IDENTITY_REGISTRY}</code> · <a href="${REPO_URL}">source</a></p>
<ul>${all.map((s) => `<li><a href="agents/${s.slug}.json">${s.slug}</a></li>`).join("")}</ul>\n`;
  writeFileSync(resolve(DOCS_DIR, "index.html"), index);
  written.push(resolve(DOCS_DIR, "index.html"));
  return written;
}

// run directly
if (process.argv[1]?.endsWith("generate-cards.ts")) {
  const files = generateAllCards();
  console.log(`wrote ${files.length} files:`);
  for (const f of files) console.log("  " + f);
}
