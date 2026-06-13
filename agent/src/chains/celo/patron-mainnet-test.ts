/**
 * One-off MAINNET verification of the patron flow, acting as an external user.
 * Derives a non-roster wallet, funds it a little cUSD from the treasury, and
 * has it deposit cUSD back to the treasury — exactly what a sponsor does via
 * the /sponsor page, but scripted so we can verify the live swarm detects it
 * and spawns a sponsored agent.
 *
 *   ALLOW_LIVE_PATRON_TEST=true npx tsx src/chains/celo/patron-mainnet-test.ts
 *
 * Prints the deposit tx + block + the lineage key to watch. Real funds move
 * (~$1.3 out, $1.0 back; net ~$1 ends up funding the spawned demo agent),
 * each tx ≤ the $5 rail and gas paid in cUSD.
 */

import "./env.js";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { FEE_CURRENCIES, TOKENS, explorerTx } from "./addresses.js";
import { assertCeloMainnet, celoPublicClient, celoWalletClient, maybeFee } from "./chain.js";
import { deriveAccount, orchestratorAccount } from "./wallets.js";
import { patronLineageKey } from "./patrons.js";

const LIVE = /^(1|true|yes)$/i.test(process.env.ALLOW_LIVE_PATRON_TEST ?? "");
const TEST_PATRON_HD = 888; // non-roster ⇒ treated as an external sponsor
const SEED_USD = 1.3;       // cUSD handed to the test wallet (covers deposit + its gas)
const DEPOSIT_USD = 1.0;    // the sponsorship the wallet sends back

async function bal(addr: `0x${string}`) {
  return Number(formatUnits(await celoPublicClient.readContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [addr],
  }), 18));
}

async function main() {
  await assertCeloMainnet();
  const treasury = orchestratorAccount();
  const patron = deriveAccount(TEST_PATRON_HD);
  console.log(`test sponsor wallet (HD ${TEST_PATRON_HD}): ${patron.address}`);
  console.log(`treasury: ${treasury.address} (${(await bal(treasury.address)).toFixed(2)} cUSD)`);
  console.log(`expected lineage key: ${patronLineageKey(patron.address)}`);

  if (!LIVE) {
    console.log("\nDRY-RUN. Set ALLOW_LIVE_PATRON_TEST=true to move real funds.");
    return;
  }

  // 1. seed the test wallet from the treasury (so it can pay cUSD gas + deposit)
  if ((await bal(patron.address)) < DEPOSIT_USD + 0.05) {
    const tw = celoWalletClient(treasury);
    const h = await tw.writeContract({
      address: TOKENS.USDm, abi: erc20Abi, functionName: "transfer",
      args: [patron.address, parseUnits(SEED_USD.toString(), 18)],
      feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
      ...(maybeFee(FEE_CURRENCIES.USDm) ? { gas: 120_000n } : {}),
    });
    await celoPublicClient.waitForTransactionReceipt({ hash: h });
    console.log(`seeded test wallet $${SEED_USD}: ${explorerTx(h)}`);
  }

  // 2. the "user" deposits cUSD to the treasury (gas paid in cUSD via CIP-64)
  const pw = celoWalletClient(patron);
  const depositTx = await pw.writeContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "transfer",
    args: [treasury.address, parseUnits(DEPOSIT_USD.toString(), 18)],
    feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
    ...(maybeFee(FEE_CURRENCIES.USDm) ? { gas: 120_000n } : {}),
  });
  const receipt = await celoPublicClient.waitForTransactionReceipt({ hash: depositTx });
  console.log(`\n✅ DEPOSIT SENT: $${DEPOSIT_USD} cUSD -> treasury`);
  console.log(`   tx:    ${explorerTx(depositTx)}`);
  console.log(`   block: ${receipt.blockNumber}`);
  console.log(`   watch lineage "${patronLineageKey(patron.address)}" for the spawned agent at the next epoch settle.`);
  console.log(`\n   To ensure the live swarm's scan window covers this deposit, set its`);
  console.log(`   state.patronScanFromBlock = ${receipt.blockNumber - 1n} before the next settle.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
