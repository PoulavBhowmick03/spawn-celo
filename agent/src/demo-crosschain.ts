/**
 * ⚠️ LEGACY / NON-FUNCTIONAL — DO NOT RUN ⚠️
 *
 * Historical cross-chain demo (Base Sepolia + Celo Sepolia) for an EARLIER
 * architecture. It is NOT the current Mantle production path and cannot run:
 *   - It imports `celoPublicClient` / `sendTxAndWaitCelo` from chain.ts, which
 *     no longer exist there.
 *   - It uses `MockGovernorABI` / `ParentTreasuryABI` / `ChildGovernorABI`,
 *     which are now empty stubs (`[] as const`) in abis.ts, and reads
 *     `getActiveChildren`, which is not on the current SpawnFactory ABI.
 *   (Note: unlike demo.ts/verify-live-vote.ts, this one already used the
 *    correct `spawnChild` name — but the surrounding deployment + clients are
 *    still deprecated, so it remains dead.)
 *
 * Retained for reference only. The `main()` guard below hard-exits before any
 * transaction is sent. The live swarm runs on Mantle via parent.ts/child.ts.
 *
 * ── Original (legacy) usage ──
 * npm run demo:crosschain
 */

import { publicClient, account, sendTxAndWait, celoPublicClient, sendTxAndWaitCelo } from "./chain.js";
import {
  MockGovernorABI,
  ParentTreasuryABI,
  SpawnFactoryABI,
  ChildGovernorABI,
} from "./abis.js";
import { reasonAboutProposal, evaluateAlignment } from "./venice.js";
import { registerAgent } from "./identity.js";
import { initSimulatedTreasury, logYieldStatus } from "./lido.js";
import { logParentAction, logChildAction } from "./logger.js";
import { toHex } from "viem";
import type { DeployedAddresses } from "./types.js";

// ========= Deployed Addresses =========
const BASE_ADDRESSES: DeployedAddresses = {
  mockGovernor: "0x377c623bf42580DAa8F6a9138639aC4861097700",
  parentTreasury: "0xd6222F060FEe779E4F6A7f604b8E37593AE279dF",
  childImplementation: "0x7d3F6A908d28D910421A90BF8E92F5D50d46e23e",
  spawnFactory: "0x15003b671d3b83a0Df2592665283742f8e65ED36",
  timeLock: "0x5962CdAF11C0A1DE9498fF05F0926ba33a0257CA",
};

const CELO_ADDRESSES: DeployedAddresses = {
  mockGovernor: "0x8aF194474ebB0425b863036177FEA2AF37e1E41C",
  parentTreasury: "0x4Fb6c048377dcdE74c44aC672166A9427ed10909",
  childImplementation: "0xcD2ED80d015883fe861c2055f63f1879B0853D96",
  spawnFactory: "0x4687E4C2B7087382d634D61fa973b134a5d9617D",
  timeLock: "0x8a3c83F32FAdDd4DA7d8d190ce740dd441D871B5",
};

// Diverse proposals — some aligned, some deliberately misaligned to test reasoning
const BASE_PROPOSALS = [
  "Allocate 500K USDC from treasury to fund public goods grants program for open-source developers",
  "Increase token inflation rate by 200% to fund marketing and growth initiatives",
  "Create a decentralized security council elected by token holders with 3-month rotation",
  "Transfer 80% of treasury to a single centralized custodian for higher yield",
  "Fund development of open-source governance tooling for all DAOs to use",
];

const CELO_PROPOSALS = [
  "Deploy mobile-first governance interface for Celo users in emerging markets",
  "Slash validator rewards by 90% and redirect to foundation multisig",
  "Fund solar-powered node infrastructure in Sub-Saharan Africa for decentralized access",
  "Remove all governance voting requirements and let foundation decide unilaterally",
  "Establish a community grants program with transparent onchain allocation",
];

async function runChain(
  chainName: string,
  addresses: DeployedAddresses,
  proposals: string[],
  sendTx: (params: any, retries?: number) => Promise<any>,
  readClient: any,
  childPrefix: string
) {
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  ${chainName.toUpperCase()} — Governance Swarm`);
  console.log(`${"═".repeat(50)}\n`);

  // Register parent
  try {
    await sendTx({
      address: addresses.parentTreasury,
      abi: ParentTreasuryABI,
      functionName: "setParentAgent",
      args: [account.address],
    });
    console.log(`[${chainName}] Parent registered`);
    logParentAction("register_parent", { chain: chainName }, { address: account.address });
  } catch {
    console.log(`[${chainName}] Parent already registered`);
  }

  // Fund factory
  try {
    await sendTx({
      address: addresses.parentTreasury,
      abi: ParentTreasuryABI,
      functionName: "deposit",
      args: [],
      value: BigInt(1e16),
    });
    await sendTx({
      address: addresses.parentTreasury,
      abi: ParentTreasuryABI,
      functionName: "fundFactory",
      args: [BigInt(1e16)],
    });
    console.log(`[${chainName}] Factory funded`);
  } catch {
    console.log(`[${chainName}] Factory funding skipped`);
  }

  // Spawn 2 children per chain
  const childNames = [`${childPrefix}-defi`, `${childPrefix}-public-goods`];
  for (const name of childNames) {
    try {
      const receipt = await sendTx({
        address: addresses.spawnFactory,
        abi: SpawnFactoryABI,
        functionName: "spawnChild",
        args: [name, addresses.mockGovernor, 0n, 200000n],
      });
      console.log(`[${chainName}] Spawned ${name} (tx: ${receipt.transactionHash.slice(0, 20)}...)`);
      logParentAction("spawn_child", { chain: chainName, name }, { txHash: receipt.transactionHash }, receipt.transactionHash);
    } catch (err: any) {
      console.log(`[${chainName}] ${name}: ${err?.message?.slice(0, 50) || "spawn skipped"}`);
    }
  }

  // Get children
  const children = (await readClient.readContract({
    address: addresses.spawnFactory,
    abi: SpawnFactoryABI,
    functionName: "getActiveChildren",
  })) as any[];

  console.log(`[${chainName}] Active children: ${children.length}`);

  // Create proposals
  console.log(`[${chainName}] Creating ${proposals.length} proposals...`);
  for (const desc of proposals) {
    try {
      await sendTx({
        address: addresses.mockGovernor,
        abi: MockGovernorABI,
        functionName: "createProposal",
        args: [desc],
      });
      console.log(`[${chainName}]   "${desc.slice(0, 55)}..."`);
    } catch {}
  }

  // Read governance values
  const values = (await readClient.readContract({
    address: addresses.parentTreasury,
    abi: ParentTreasuryABI,
    functionName: "getGovernanceValues",
  })) as string;

  // Children vote
  const proposalCount = (await readClient.readContract({
    address: addresses.mockGovernor,
    abi: MockGovernorABI,
    functionName: "proposalCount",
  })) as bigint;

  console.log(`[${chainName}] Children voting on ${proposalCount} proposals via Venice AI...`);

  for (const child of children) {
    for (let p = 1n; p <= proposalCount; p++) {
      try {
        // Check if already voted
        const voteIdx = (await readClient.readContract({
          address: child.childAddr,
          abi: ChildGovernorABI,
          functionName: "proposalToVoteIndex",
          args: [p],
        })) as bigint;
        if (voteIdx > 0n) continue;

        const proposal = (await readClient.readContract({
          address: addresses.mockGovernor,
          abi: MockGovernorABI,
          functionName: "getProposal",
          args: [p],
        })) as any;

        const systemPrompt = `You are autonomous governance agent "${child.ensLabel}" on ${chainName}. Vote according to owner values. Be decisive — some proposals may conflict with the values. Vote AGAINST harmful proposals.`;

        const { decision, reasoning } = await reasonAboutProposal(
          proposal.description,
          values,
          systemPrompt
        );

        const support = decision === "FOR" ? 1 : decision === "AGAINST" ? 0 : 2;

        const receipt = await sendTx({
          address: child.childAddr,
          abi: ChildGovernorABI,
          functionName: "castVote",
          args: [p, support, toHex(reasoning)],
        });

        const icon = decision === "FOR" ? "+" : decision === "AGAINST" ? "x" : "~";
        console.log(`[${chainName}]   [${icon}] ${child.ensLabel} voted ${decision} on P${p}`);
        logChildAction(child.ensLabel, "cast_vote", {
          chain: chainName, proposalId: p.toString(),
          proposal: proposal.description.slice(0, 80), decision,
        }, { reasoning: reasoning.slice(0, 150) }, receipt.transactionHash);
      } catch (err: any) {
        console.log(`[${chainName}]   ${child.ensLabel} P${p}: ${err?.message?.slice(0, 40) || "vote failed"}`);
      }
    }
  }

  // Parent evaluates alignment
  console.log(`[${chainName}] Parent evaluating alignment...`);
  for (const child of children) {
    try {
      const history = (await readClient.readContract({
        address: child.childAddr,
        abi: ChildGovernorABI,
        functionName: "getVotingHistory",
      })) as any[];

      if (history.length === 0) continue;

      const historyForEval = history.map((v: any) => ({
        proposalId: v.proposalId.toString(),
        support: Number(v.support),
      }));

      const score = await evaluateAlignment(values, historyForEval);
      const clamped = Math.min(Math.max(score, 0), 100);
      const label = clamped >= 70 ? "ALIGNED" : clamped >= 40 ? "DRIFTING" : "MISALIGNED";

      await sendTx({
        address: child.childAddr,
        abi: ChildGovernorABI,
        functionName: "updateAlignmentScore",
        args: [BigInt(clamped)],
      });

      console.log(`[${chainName}]   ${child.ensLabel}: ${clamped}/100 [${label}]`);
      logParentAction("evaluate_alignment", { chain: chainName, child: child.ensLabel }, { score: clamped, label });
    } catch {}
  }
}

async function main() {
  // LEGACY GUARD: non-functional (imports clients/ABIs that no longer exist and
  // targets deprecated Base/Celo Sepolia deployments). Refuse to run unless
  // explicitly forced.
  if (process.env.ALLOW_LEGACY_DEMO !== "true") {
    console.error(
      "demo-crosschain.ts is LEGACY and non-functional (deprecated Base/Celo\n" +
      "Sepolia deployment; missing celo clients/ABIs). It will not run.\n" +
      "See the live Mantle swarm in parent.ts / child.ts / swarm.ts."
    );
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  SPAWN PROTOCOL — CROSS-CHAIN GOVERNANCE SWARM  ║");
  console.log("║  Base Sepolia + Celo Sepolia · Venice AI · Live  ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`\nAgent: ${account.address}`);

  initSimulatedTreasury(BigInt(2e18), Math.floor(Date.now() / 1000) - 172800);

  // Register ERC-8004 identities for cross-chain agents
  try {
    await registerAgent("spawn://parent.spawn.eth", {
      agentType: "parent", assignedDAO: "multi-chain",
      governanceContract: BASE_ADDRESSES.mockGovernor,
      ensName: "parent.spawn.eth", alignmentScore: 100,
      capabilities: ["spawn", "evaluate", "terminate", "cross-chain"],
      createdAt: Date.now(),
    });
  } catch {}

  // Run Base Sepolia
  await runChain("Base Sepolia", BASE_ADDRESSES, BASE_PROPOSALS, sendTxAndWait, publicClient, "base");

  // Run Celo Sepolia
  await runChain("Celo Sepolia", CELO_ADDRESSES, CELO_PROPOSALS, sendTxAndWaitCelo, celoPublicClient, "celo");

  // Yield status
  console.log(`\n${"═".repeat(50)}`);
  console.log("  TREASURY YIELD STATUS");
  console.log(`${"═".repeat(50)}`);
  await logYieldStatus();

  // Summary
  console.log(`\n${"═".repeat(50)}`);
  console.log("  CROSS-CHAIN DEMO COMPLETE");
  console.log(`${"═".repeat(50)}`);
  console.log("Chains: Base Sepolia + Celo Sepolia");
  console.log("Reasoning: Venice AI (llama-3.3-70b, private)");
  console.log("Identity: ERC-8004 (IDs 2220-2223)");
  console.log(`Base explorer: https://sepolia.basescan.org/address/${BASE_ADDRESSES.spawnFactory}`);
  console.log(`Celo explorer: https://celo-sepolia.celoscan.io/address/${CELO_ADDRESSES.spawnFactory}`);
}

main().catch(console.error);
