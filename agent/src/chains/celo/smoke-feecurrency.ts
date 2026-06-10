/**
 * Phase 1 smoke test (CLAUDE.md §6): agent wallet 1 sends $0.01 of cUSD
 * (USDm) to the orchestrator wallet, paying gas in cUSD via CIP-64
 * feeCurrency. Proves: HD derivation, celo tx serialization, fee
 * abstraction — agents never hold CELO.
 *
 * SAFE BY DEFAULT: dry-run unless ALLOW_LIVE_SMOKE=true. Even live, the
 * budget rails apply.
 *
 *   pnpm -C agent exec tsx src/chains/celo/smoke-feecurrency.ts          # dry-run
 *   ALLOW_LIVE_SMOKE=true pnpm -C agent exec tsx src/chains/celo/smoke-feecurrency.ts
 */

import "./env.js"; // must be first — loads repo-root .env before env-reading modules
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { TOKENS, FEE_CURRENCIES, explorerTx } from "./addresses.js";
import { assertCeloMainnet, celoPublicClient, celoWalletClient } from "./chain.js";
import { agentAccount, orchestratorAccount } from "./wallets.js";
import { assertTxAllowed } from "./budget.js";
import { logActivity, activityLogPath } from "./activity-log.js";

const LIVE = /^(1|true|yes)$/i.test(process.env.ALLOW_LIVE_SMOKE ?? "");
const AMOUNT_USD = 0.01;
const AMOUNT = parseUnits(AMOUNT_USD.toFixed(2), 18); // USDm is 18 decimals

async function main() {
  await assertCeloMainnet();

  const sender = agentAccount(1);
  const recipient = orchestratorAccount();
  console.log(`orchestrator (HD index 0): ${recipient.address}`);
  console.log(`agent-1      (HD index 1): ${sender.address}`);

  const [usdm, celoNative] = await Promise.all([
    celoPublicClient.readContract({
      address: TOKENS.USDm,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [sender.address],
    }),
    celoPublicClient.getBalance({ address: sender.address }),
  ]);
  console.log(`agent-1 balances: ${formatUnits(usdm, 18)} USDm, ${formatUnits(celoNative, 18)} CELO`);
  console.log(`(CELO balance should stay 0 forever — gas comes out of USDm)`);

  if (usdm < AMOUNT * 2n) {
    // need amount + gas headroom in the same token
    console.error(
      `\nNOT FUNDED: send ~$1 of cUSD/USDm to agent-1 ${sender.address} and re-run.`,
    );
    process.exit(1);
  }

  if (!LIVE) {
    console.log(
      `\nDRY-RUN. Would send ${AMOUNT_USD} USDm → ${recipient.address}, feeCurrency=USDm (${FEE_CURRENCIES.USDm}).` +
        `\nSet ALLOW_LIVE_SMOKE=true to broadcast (requires explicit developer go-ahead per CLAUDE.md §6 Phase 1).`,
    );
    return;
  }

  assertTxAllowed(AMOUNT_USD, "feecurrency smoke transfer");

  const wallet = celoWalletClient(sender);
  const hash = await wallet.writeContract({
    chain: wallet.chain,
    account: sender,
    address: TOKENS.USDm,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient.address, AMOUNT],
    feeCurrency: FEE_CURRENCIES.USDm, // CIP-64: gas paid in cUSD
  });
  console.log(`\nbroadcast: ${explorerTx(hash)}`);

  const receipt = await celoPublicClient.waitForTransactionReceipt({ hash });
  const after = await celoPublicClient.getBalance({ address: sender.address });

  const entry = logActivity({
    agentId: "agent-1",
    action: "feecurrency-smoke-transfer",
    rationale:
      `Phase 1 smoke test: transfer $${AMOUNT_USD} cUSD(USDm) agent-1 → orchestrator with ` +
      `CIP-64 feeCurrency=USDm, proving agents pay gas in the stablecoin they hold and ` +
      `never touch CELO (native balance after tx: ${formatUnits(after, 18)} CELO).`,
    txHash: hash,
    status: receipt.status,
    gasUsed: receipt.gasUsed.toString(),
    feeCurrency: FEE_CURRENCIES.USDm,
  });

  console.log(`status: ${receipt.status}, gasUsed: ${receipt.gasUsed}`);
  console.log(`activity logged → ${activityLogPath()}`);
  console.log(JSON.stringify(entry, null, 2));

  if (receipt.status !== "success") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
