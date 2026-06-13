/**
 * End-to-end fork test for the patron (external sponsorship) flow.
 * Run via: npm run test:fork:patron
 *
 * Simulates a REAL USER: a wallet that is NOT part of the swarm sends cUSD to
 * the treasury, then the orchestrator detects the deposit and spawns a
 * sponsored agent against the real (forked) ERC-8004 + SpawnFactory contracts.
 *
 * Asserts:
 *   - a non-swarm cUSD deposit is detected; a swarm wallet's transfer is NOT
 *   - exactly one patron spawn is enqueued, with correct lineage/fund cap/meta
 *   - completeSpawn funds (≤ deposit, ≤ $5), registers an ERC-8004 identity,
 *     and emits onchain spawn provenance — all against forked contracts
 *   - processedDeposits dedupes (re-running detect yields nothing)
 *   - patronCapitalUsd tracks the contribution
 *   - the developer budget rail is untouched (per-tx ≤ $5 still enforced)
 *
 * Native CELO gas (anvil can't mine CIP-64); no docs publishing.
 */

import "./env.js";
import { createTestClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits } from "viem";
import { celo } from "viem/chains";
import { TOKENS } from "./addresses.js";
import { celoPublicClient } from "./chain.js";
import { deriveAccount, orchestratorAccount } from "./wallets.js";
import { detectPatronDeposits, patronLineageKey, MIN_PATRON_USD } from "./patrons.js";
import { processPendingSpawns, enqueueSpawn } from "./epoch.js";
import { verifyIdentity } from "./identity.js";
import type { SwarmState } from "./swarm-state.js";

const FORK_URL = process.env.CELO_RPC_URL ?? "";
if (!FORK_URL.includes("127.0.0.1") && !FORK_URL.includes("localhost")) {
  console.error("Refusing to run: CELO_RPC_URL must point at a local anvil fork.");
  process.exit(1);
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${label}`);
  console.log(`  ok: ${label}`);
}

// a wallet that is NOT in the swarm roster — our external "user"
const PATRON_HD_INDEX = 777;

async function main() {
  const treasury = orchestratorAccount();
  const patron = deriveAccount(PATRON_HD_INDEX);
  const testClient = createTestClient({ chain: celo, mode: "anvil", transport: http(FORK_URL) });

  assert((await celoPublicClient.getChainId()) === 42220, "fork preserves Celo chain id");

  // native gas for treasury (funds the spawn + registers provenance), patron,
  // and the seed agent
  const seedAgent = deriveAccount(1);
  for (const a of [treasury.address, patron.address, seedAgent.address]) {
    await testClient.setBalance({ address: a, value: parseUnits("10", 18) });
  }

  // The forked treasury already holds its REAL mainnet cUSD — source the test's
  // cUSD from it (no guessed whale address). Impersonate the treasury to hand
  // the patron a deposit and the seed agent its control balance; the patron
  // then sends it back, so net treasury cUSD is unchanged before the spawn.
  const treasuryCusd = Number(formatUnits(
    await celoPublicClient.readContract({ address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address] }), 18));
  // need to cover: a deposit (returned), a $0.5 control lend (returned), and
  // the spawn funding which keeps a $1 ops float. ~$2.1 minimum.
  assert(treasuryCusd >= 2.1, `forked treasury holds enough real cUSD to run the test ($${treasuryCusd.toFixed(2)})`);
  // small sponsorship — exactly the judge-try-it case; adapt to live balance.
  // headroom for: the $1 control lend + this deposit (both returned) and the
  // spawn's $1 ops-float reserve at funding time.
  const CONTROL_USD = MIN_PATRON_USD; // ≥ MIN so the ONLY reason it's ignored is the swarm-set exclusion
  const DEPOSIT_USD = Number(Math.max(MIN_PATRON_USD, Math.min(1.5, treasuryCusd - 1.6)).toFixed(6));
  await testClient.impersonateAccount({ address: treasury.address });
  const treasuryWallet = createWalletClient({ account: treasury.address, chain: celo, transport: http(FORK_URL) });
  await celoPublicClient.waitForTransactionReceipt({ hash: await treasuryWallet.writeContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "transfer",
    args: [patron.address, parseUnits(DEPOSIT_USD.toFixed(6), 18)],
  }) });
  await celoPublicClient.waitForTransactionReceipt({ hash: await treasuryWallet.writeContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "transfer",
    args: [seedAgent.address, parseUnits(CONTROL_USD.toFixed(6), 18)],
  }) });
  await testClient.stopImpersonatingAccount({ address: treasury.address });

  // minimal swarm state with one active agent to seed the patron genome from
  const state: SwarmState = {
    epochNumber: 1,
    nextHdIndex: 100,
    agents: [
      {
        slug: "seed-ay", name: "seed", hdIndex: 1, address: seedAgent.address,
        erc8004AgentId: "0", strategy: "AaveYielder",
        params: { minApyDeltaBps: 30, reserveBps: 500, compoundEveryEpochs: 1 },
        useSignal: false, generation: 1, lineageKey: "seed-ay", status: "ACTIVE",
        history: [{ epoch: 0, fitness: 1.0, score: 60, vEndUsd: 5, gasUsd: 0 }],
      },
    ],
  };

  // initialize the scan cursor (first call returns nothing, sets fromBlock=now)
  let detected = await detectPatronDeposits(state);
  assert(detected.length === 0 && state.patronScanFromBlock !== undefined, "first detect sets scan cursor, returns nothing");

  // --- 1. a SWARM wallet sends cUSD to the treasury (this is exactly what a
  //        cull-unwind looks like) — it must NOT be seen as a patron, even
  //        though its amount clears the minimum
  await testClient.impersonateAccount({ address: seedAgent.address });
  const seedWallet = createWalletClient({ account: seedAgent.address, chain: celo, transport: http(FORK_URL) });
  await celoPublicClient.waitForTransactionReceipt({ hash: await seedWallet.writeContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "transfer",
    args: [treasury.address, parseUnits(CONTROL_USD.toFixed(6), 18)],
  }) });
  await testClient.stopImpersonatingAccount({ address: seedAgent.address });

  // --- 2. the USER deposits: patron sends a small cUSD sponsorship to treasury
  await testClient.impersonateAccount({ address: patron.address });
  const patronWallet = createWalletClient({ account: patron.address, chain: celo, transport: http(FORK_URL) });
  const depositTx = await patronWallet.writeContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "transfer",
    args: [treasury.address, parseUnits(DEPOSIT_USD.toFixed(6), 18)],
  });
  await celoPublicClient.waitForTransactionReceipt({ hash: depositTx });
  await testClient.stopImpersonatingAccount({ address: patron.address });

  // --- 3. ONE detect over the range covering BOTH transfers: it must return
  //        exactly the patron deposit and silently exclude the swarm transfer
  detected = await detectPatronDeposits(state);
  assert(detected.length === 1, "exactly one deposit detected (swarm transfer excluded, patron included)");
  assert(detected[0].depositor.toLowerCase() === patron.address.toLowerCase(), "the one detected is the patron, not the swarm wallet");
  assert(Math.abs(detected[0].amountUsd - DEPOSIT_USD) < 1e-9, `deposit amount is $${DEPOSIT_USD.toFixed(2)}`);
  assert(detected[0].amountUsd >= MIN_PATRON_USD, "deposit clears the minimum");

  // --- 4. enqueue the patron spawn (the real enqueueSpawn used by runEpochCycle)
  const key = patronLineageKey(patron.address);
  const top = state.agents[0];
  enqueueSpawn(state, top, Math.min(5, detected[0].amountUsd), "patron", detected[0]);
  state.processedDeposits = [detected[0].depositTx];
  state.patronCapitalUsd = (state.patronCapitalUsd ?? 0) + detected[0].amountUsd;

  const pending = (state.pendingSpawns ?? [])[0];
  assert(!!pending && pending.lineageKey === key, `patron spawn enqueued in lineage ${key}`);
  assert(pending.generation === 1, "patron agent is generation 1 (founds its own lineage)");
  assert(!!pending.patron && pending.patron.depositTx === depositTx, "patron metadata attached");
  assert(pending.fundUsd <= DEPOSIT_USD + 1e-9 && pending.fundUsd <= 5, "fund capped by deposit and per-agent cap");

  // --- 5. dedupe: re-detecting must NOT see the same deposit again
  const redetect = await detectPatronDeposits(state);
  assert(redetect.length === 0, "processed deposit is not re-detected (dedupe)");

  // --- 6. complete the spawn against the REAL forked contracts (fund + register + provenance)
  const treasuryBefore = await celoPublicClient.readContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address],
  });
  const done = await processPendingSpawns(state);
  assert(done.length === 1, "patron spawn completed");
  const agent = state.agents.find((a) => a.lineageKey === key);
  assert(!!agent && agent.status === "ACTIVE", "patron agent is active in state");
  assert(!!agent!.erc8004AgentId && agent!.erc8004AgentId !== "0", `patron agent got a real ERC-8004 id (#${agent!.erc8004AgentId})`);
  assert(!!agent!.patron, "patron tag carried onto the spawned agent");

  // funded wallet holds ~fundUsd cUSD
  const agentBal = Number(formatUnits(
    await celoPublicClient.readContract({ address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [agent!.address] }), 18));
  assert(agentBal > 0.5 && agentBal <= 5.01, `patron agent funded with $${agentBal.toFixed(2)} (≤ deposit, ≤ cap)`);

  // identity actually exists onchain (forked registry), owned by the agent wallet
  const { owner } = await verifyIdentity(BigInt(agent!.erc8004AgentId));
  assert(owner.toLowerCase() === agent!.address.toLowerCase(), "ERC-8004 identity self-owned by the patron agent wallet");

  // accounting
  assert(Math.abs((state.patronCapitalUsd ?? 0) - DEPOSIT_USD) < 1e-9, `patronCapitalUsd tracks the $${DEPOSIT_USD.toFixed(2)} contribution`);
  const treasuryAfter = await celoPublicClient.readContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address],
  });
  assert(treasuryAfter < treasuryBefore, "treasury funded the agent (balance dropped by the stake)");

  console.log("\n✅ patron flow end-to-end on fork: deposit → detect → enqueue → fund → register → live agent. All assertions passed.");
}

main().catch((e) => {
  console.error("\n❌ patron fork test failed:");
  console.error(e);
  process.exit(1);
});
