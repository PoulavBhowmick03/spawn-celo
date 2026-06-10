/**
 * Phase 3: register the orchestrator + all 9 swarm agents in the canonical
 * Celo ERC-8004 Identity Registry. Idempotent via docs/agents/registry.json.
 *
 * Preconditions enforced: each agent card URL must resolve over HTTP before
 * its registration is sent (CLAUDE.md §8 — indexers may fetch at
 * registration time).
 *
 * Each agent registers itself (identity owner = agent wallet); the
 * orchestrator seeds 0.15 cUSD of gas money to any agent wallet that needs
 * it. Gas in cUSD everywhere.
 *
 *   npm run register:agents              # dry-run
 *   ALLOW_LIVE_REGISTER=true npm run register:agents
 */

import "./env.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { FEE_CURRENCIES, TOKENS, explorerTx } from "./addresses.js";
import { assertCeloMainnet, celoPublicClient, celoWalletClient } from "./chain.js";
import { deriveAccount, orchestratorAccount } from "./wallets.js";
import { ORCHESTRATOR_SPEC, SWARM_AGENTS } from "./agents-config.js";
import { registerIdentity, verifyIdentity } from "./identity.js";
import { assertTxAllowed } from "./budget.js";
import { logActivity } from "./activity-log.js";
import { cardUrl, generateAllCards, loadRegistry, type RegistryFile } from "./generate-cards.js";

const LIVE = /^(1|true|yes)$/i.test(process.env.ALLOW_LIVE_REGISTER ?? "");
const GAS_SEED = parseUnits("0.15", 18); // cUSD per agent for registration gas
const REGISTRY_PATH = resolve(process.cwd(), "..", "docs", "agents", "registry.json");

async function ensureCardResolves(url: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`agent card does not resolve (${res.status}): ${url}`);
  const body = await res.json();
  if (!body?.name) throw new Error(`agent card resolves but looks malformed: ${url}`);
}

async function main() {
  await assertCeloMainnet();
  const registry: RegistryFile = loadRegistry();
  const treasury = orchestratorAccount();
  const treasuryWallet = celoWalletClient(treasury);

  const roster = [ORCHESTRATOR_SPEC, ...SWARM_AGENTS];
  console.log(`roster: ${roster.length} identities (1 orchestrator + ${SWARM_AGENTS.length} agents)`);

  for (const spec of roster) {
    const url = cardUrl(spec.slug);
    if (registry[spec.slug]) {
      console.log(`${spec.slug}: already registered as #${registry[spec.slug].agentId} — skipping`);
      continue;
    }

    console.log(`${spec.slug}: checking card ${url}`);
    await ensureCardResolves(url);

    const account = deriveAccount(spec.hdIndex ?? 0);
    if (!LIVE) {
      console.log(`${spec.slug}: DRY-RUN would register ${account.address} with ${url}`);
      continue;
    }

    // gas seed for agent wallets (orchestrator pays its own)
    if (spec.hdIndex !== 0) {
      const bal = await celoPublicClient.readContract({
        address: TOKENS.USDm,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      if (bal < parseUnits("0.05", 18)) {
        assertTxAllowed(0.15, `gas seed for ${spec.slug}`);
        const hash = await treasuryWallet.writeContract({
          address: TOKENS.USDm,
          abi: erc20Abi,
          functionName: "transfer",
          args: [account.address, GAS_SEED],
          feeCurrency: FEE_CURRENCIES.USDm,
        });
        const rcpt = await celoPublicClient.waitForTransactionReceipt({ hash });
        if (rcpt.status !== "success") throw new Error(`gas seed reverted for ${spec.slug}`);
        logActivity({
          agentId: "orchestrator",
          action: "gas-seed",
          rationale: `Seed ${formatUnits(GAS_SEED, 18)} cUSD to ${spec.slug} (${account.address}) so it can pay its own ERC-8004 registration gas in cUSD (self-registration keeps the identity owner distinct from the orchestrator, which must post reputation feedback later).`,
          txHash: hash,
          recipient: account.address,
        });
        console.log(`${spec.slug}: gas seeded (${explorerTx(hash)})`);
      }
    }

    const { agentId, txHash } = await registerIdentity(account, spec.slug, url);
    registry[spec.slug] = {
      agentId: agentId.toString(),
      address: account.address,
      txHash,
    };
    writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
    console.log(`${spec.slug}: registered as ERC-8004 #${agentId} (${explorerTx(txHash)})`);

    // read back from the registry contract — never trust the UI (CLAUDE.md §8)
    const check = await verifyIdentity(agentId);
    if (check.owner.toLowerCase() !== account.address.toLowerCase() || check.uri !== url) {
      throw new Error(
        `onchain verification mismatch for ${spec.slug}: owner=${check.owner} uri=${check.uri}`,
      );
    }
    console.log(`${spec.slug}: onchain verified (owner + tokenURI match)`);
  }

  if (LIVE) {
    // embed minted agentIds into the cards (same URLs — no setAgentURI needed)
    generateAllCards();
    console.log("\ncards regenerated with registrations[] — commit and push docs/ to publish");
  }
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
