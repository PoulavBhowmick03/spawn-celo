/**
 * Phase 2 integration test against an anvil fork of Celo mainnet.
 * No real funds move. Run via: npm run test:fork:celo
 * (the script starts anvil, points CELO_RPC_URL at it, and tears it down)
 *
 * Exercises the full agent lifecycle the swarm will use:
 *   treasury funds agent → agent supplies Aave → agent swaps via Mento →
 *   agent is "culled" → unwindAgentToTreasury returns everything home.
 *
 * Gas is paid in native CELO here (anvil doesn't mine CIP-64 fee-currency
 * txs); fee abstraction itself is already proven live on mainnet (Phase 1).
 */

import "./env.js";
import {
  createTestClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { celo } from "viem/chains";
import { TOKENS } from "./addresses.js";
import { celoPublicClient } from "./chain.js";
import { agentAccount, orchestratorAccount } from "./wallets.js";
import { getSupplyApy, getAavePosition, supplyToAave } from "./aave.js";
import { executeSwap, quoteSwap } from "./mento.js";
import { unwindAgentToTreasury } from "./unwind.js";

const FORK_URL = process.env.CELO_RPC_URL ?? "";
if (!FORK_URL.includes("127.0.0.1") && !FORK_URL.includes("localhost")) {
  console.error("Refusing to run: CELO_RPC_URL must point at a local anvil fork.");
  process.exit(1);
}

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${label}`);
  console.log(`  ok: ${label}`);
}

async function main() {
  const treasury = orchestratorAccount();
  const agent1 = agentAccount(1);
  const testClient = createTestClient({ chain: celo, mode: "anvil", transport: http(FORK_URL) });

  const chainId = await celoPublicClient.getChainId();
  assert(chainId === 42220, `fork preserves Celo chain id (got ${chainId})`);

  // gas + funding: impersonate the real treasury on the fork
  await testClient.setBalance({ address: treasury.address, value: parseUnits("10", 18) });
  await testClient.setBalance({ address: agent1.address, value: parseUnits("10", 18) });
  await testClient.impersonateAccount({ address: treasury.address });
  const treasuryRpcWallet = createWalletClient({
    account: treasury.address,
    chain: celo,
    transport: http(FORK_URL),
  });

  const seed = parseUnits("5", 18);
  const fundHash = await treasuryRpcWallet.writeContract({
    address: TOKENS.USDm,
    abi: erc20Abi,
    functionName: "transfer",
    args: [agent1.address, seed],
  });
  await celoPublicClient.waitForTransactionReceipt({ hash: fundHash });
  const agentStart = await celoPublicClient.readContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [agent1.address],
  });
  assert(agentStart >= seed, `agent-1 funded with 5 cUSD (has ${formatUnits(agentStart, 18)})`);

  // 1. live yield read
  const apy = await getSupplyApy("USDm");
  assert(apy > 0 && apy < 100, `Aave USDm supply APY live read: ${apy.toFixed(3)}%`);

  // 2. supply $2 to Aave
  await supplyToAave(agent1, "USDm", parseUnits("2", 18), {
    agentId: "agent-1",
    usdValue: 2,
    rationale: "fork test: supply $2 cUSD to Aave v3",
  });
  const pos = await getAavePosition("USDm", agent1.address);
  assert(pos >= parseUnits("1.999", 18), `aUSDm position ≈ 2 (${formatUnits(pos, 18)})`);

  // 3. FX leg: swap $1 cUSD -> USDT via Mento
  const quote = await quoteSwap(TOKENS.USDm, TOKENS.USDT, parseUnits("1", 18));
  assert(quote > 0n, `Mento quote 1 cUSD -> ${formatUnits(quote, 6)} USDT`);
  await executeSwap({
    account: agent1,
    agentId: "agent-1",
    tokenIn: TOKENS.USDm,
    tokenOut: TOKENS.USDT,
    amountIn: parseUnits("1", 18),
    tokenInDecimals: 18,
    tokenOutDecimals: 6,
    usdValue: 1,
    rationale: "fork test: rotate $1 cUSD into USDT",
  });
  const usdtBal = await celoPublicClient.readContract({
    address: TOKENS.USDT, abi: erc20Abi, functionName: "balanceOf", args: [agent1.address],
  });
  assert(usdtBal > 0n, `agent-1 holds ${formatUnits(usdtBal, 6)} USDT after swap`);

  // 4. cull: everything must come home to the treasury
  const treasuryBefore = await celoPublicClient.readContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address],
  });
  const result = await unwindAgentToTreasury(
    agent1, "agent-1", treasury.address, "fork-test cull", false,
  );
  console.log(`  unwind used ${result.txHashes.length} txs, swept ${formatUnits(result.sweptUsdm, 18)} cUSD`);

  const [aPosAfter, usdtAfter, usdmAfter, treasuryAfter] = await Promise.all([
    getAavePosition("USDm", agent1.address),
    celoPublicClient.readContract({ address: TOKENS.USDT, abi: erc20Abi, functionName: "balanceOf", args: [agent1.address] }),
    celoPublicClient.readContract({ address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [agent1.address] }),
    celoPublicClient.readContract({ address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address] }),
  ]);
  assert(aPosAfter < parseUnits("0.001", 18), `Aave position emptied (${formatUnits(aPosAfter, 18)})`);
  assert(usdtAfter <= 10n, `USDT swept (${formatUnits(usdtAfter, 6)} left)`);
  assert(usdmAfter < parseUnits("0.001", 18), `cUSD swept (${formatUnits(usdmAfter, 18)} left)`);
  const recovered = treasuryAfter - treasuryBefore;
  assert(
    recovered >= parseUnits("4.9", 18),
    `treasury recovered ${formatUnits(recovered, 18)} of the 5 cUSD seed (loss = swap spread + dust only)`,
  );

  // 5. termination consequence: fitness → reputation score → onchain feedback
  const { fitness, median, reputationScore } = await import("./fitness.js");
  const { postEpochFeedback, readReputationSummary } = await import("./reputation.js");

  const vStart = Number(formatUnits(agentStart, 18));
  const vEnd = Number(formatUnits(result.sweptUsdm, 18));
  const culledFitness = fitness({ vStartUsd: vStart, vEndUsd: vEnd, gasUsd: 0.002, epochHours: 4 });
  const swarmMedian = median([culledFitness, 0.5, 1.0]); // synthetic peers for the test
  const score = reputationScore(culledFitness, swarmMedian);
  console.log(`  culled agent fitness=${culledFitness.toFixed(3)}, median=${swarmMedian.toFixed(3)}, score=${score}`);
  assert(score >= 0 && score <= 100, `score bounded (${score})`);
  assert(culledFitness < swarmMedian, "culled agent scored below synthetic median");

  // mfx-cautious (#9241) exists on the fork — registered on mainnet in Phase 3
  const AGENT_ID = 9241n;
  const fbTx = await postEpochFeedback(
    treasury,
    {
      agentId: AGENT_ID,
      agentSlug: "mfx-cautious",
      score,
      strategy: "MentoFXRotator",
      epochNumber: 0,
      fitnessInputs: { vStartUsd: vStart, vEndUsd: vEnd, gasUsd: 0.002, epochHours: 4 },
      feedbackURI: "https://poulavbhowmick03.github.io/spawn-celo/agents/mfx-cautious.json",
    },
    false,
  );
  console.log(`  giveFeedback tx: ${fbTx}`);
  const summary = await readReputationSummary(AGENT_ID, treasury.address);
  assert(summary.count === 1n, `reputation registry recorded 1 feedback (count=${summary.count})`);
  assert(
    Number(summary.value) === score,
    `summary value ${summary.value} (decimals ${summary.decimals}) matches posted score ${score}`,
  );

  console.log("\nFORK TEST PASSED — fund→deploy→cull→refund→fitness→reputation verified.");
}

main().catch((e) => {
  console.error("\nFORK TEST FAILED:", e);
  process.exit(1);
});
