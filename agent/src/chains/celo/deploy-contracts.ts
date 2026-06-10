/**
 * Deploy the Spawn provenance contracts to Celo mainnet, unchanged from the
 * Mantle deployment (CLAUDE.md §3.1: prefer redeploying audited-by-use
 * contracts as-is):
 *
 *   1. LineageRegistry()              — post-mortem CIDs + generation results
 *   2. ChildAgent (implementation)    — cloned per spawned agent
 *   3. SpawnFactory(impl, lineage)    — onchain spawn/recall events
 *
 * SpawnFactory's ERC8004_REGISTRY constant is the TESTNET address, which has
 * no bytecode on Celo mainnet — the factory's documented graceful path
 * (agentId = 0). That is intentional: ERC-8004 identities are minted by the
 * runtime from each agent's own wallet (Phase 3), keeping identity owners
 * distinct from the orchestrator so reputation feedback is legal.
 *
 * Deployed via viem with CIP-64 feeCurrency=cUSD — the deployer (orchestrator)
 * holds zero CELO, like every other wallet in this project.
 *
 *   npm run deploy:celo                          # dry-run
 *   ALLOW_LIVE_DEPLOY=true npm run deploy:celo   # broadcast
 */

import "./env.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Abi, Address, Hex } from "viem";
import { FEE_CURRENCIES, explorerAddress } from "./addresses.js";
import { assertCeloMainnet, celoPublicClient, celoWalletClient } from "./chain.js";
import { orchestratorAccount } from "./wallets.js";
import { assertTxAllowed } from "./budget.js";
import { logActivity } from "./activity-log.js";

const LIVE = /^(1|true|yes)$/i.test(process.env.ALLOW_LIVE_DEPLOY ?? "");
const OUT = resolve(process.cwd(), "..", "contracts", "out");
const DEPLOYMENTS_PATH = resolve(process.cwd(), "..", "docs", "deployments.celo.json");

function artifact(sol: string, name: string): { abi: Abi; bytecode: Hex } {
  const j = JSON.parse(readFileSync(resolve(OUT, `${sol}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
}

type Deployments = Record<string, { address: Address; txHash: Hex }>;

async function main() {
  await assertCeloMainnet();
  const deployer = orchestratorAccount();
  const wallet = celoWalletClient(deployer);
  const deployments: Deployments = existsSync(DEPLOYMENTS_PATH)
    ? JSON.parse(readFileSync(DEPLOYMENTS_PATH, "utf8"))
    : {};

  async function deploy(sol: string, name: string, args: unknown[]): Promise<Address> {
    if (deployments[name]) {
      console.log(`${name}: already deployed at ${deployments[name].address} — skipping`);
      return deployments[name].address;
    }
    const { abi, bytecode } = artifact(sol, name);
    if (!LIVE) {
      console.log(`${name}: DRY-RUN would deploy with args ${JSON.stringify(args)}`);
      return "0x0000000000000000000000000000000000000000";
    }
    assertTxAllowed(0, `deploy ${name} (moves no funds)`);
    const txHash = await wallet.deployContract({
      abi,
      bytecode,
      args,
      feeCurrency: FEE_CURRENCIES.USDm,
    });
    const receipt = await celoPublicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error(`${name} deploy failed: ${txHash}`);
    }
    const address = receipt.contractAddress;
    deployments[name] = { address, txHash };
    writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(deployments, null, 2) + "\n");
    logActivity({
      agentId: "orchestrator",
      action: "contract-deploy",
      rationale: `Deploy ${name} to Celo mainnet (unchanged from the audited-by-use Mantle deployment) for onchain spawn/recall/lineage provenance. Gas paid in cUSD via CIP-64 — deployer holds no CELO.`,
      txHash,
      contract: name,
      address,
    });
    console.log(`${name}: deployed at ${explorerAddress(address)} (gas ${receipt.gasUsed})`);
    return address;
  }

  const lineage = await deploy("LineageRegistry", "LineageRegistry", []);
  const childImpl = await deploy("ChildAgent", "ChildAgent", []);
  await deploy("SpawnFactory", "SpawnFactory", [childImpl, lineage]);

  if (LIVE) {
    // belt-and-braces: confirm bytecode for all three
    for (const [name, d] of Object.entries(deployments)) {
      const code = await celoPublicClient.getCode({ address: d.address });
      if (!code || code === "0x") throw new Error(`${name} has no bytecode at ${d.address}`);
      console.log(`${name}: bytecode verified (${(code.length - 2) / 2} bytes)`);
    }
    console.log(`\ndeployments written to ${DEPLOYMENTS_PATH}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
