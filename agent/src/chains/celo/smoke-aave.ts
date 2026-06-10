/**
 * Phase 2 mainnet smoke (CLAUDE.md §6): orchestrator supplies $2 cUSD to
 * Aave v3 Celo, verifies the aToken position, withdraws in full. Gas in
 * cUSD throughout. Dry-run unless ALLOW_LIVE_AAVE_SMOKE=true.
 */

import "./env.js"; // must be first
import { formatUnits, parseUnits } from "viem";
import { explorerTx } from "./addresses.js";
import { assertCeloMainnet } from "./chain.js";
import { FEE_CURRENCIES } from "./addresses.js";
import { orchestratorAccount } from "./wallets.js";
import { getSupplyApy, getAavePosition, supplyToAave, withdrawFromAave } from "./aave.js";

const LIVE = /^(1|true|yes)$/i.test(process.env.ALLOW_LIVE_AAVE_SMOKE ?? "");
const AMOUNT = parseUnits("2", 18);

/** forno is load-balanced; a read right after a write can hit a lagging
 *  node (CLAUDE.md §8). Retry with backoff before declaring failure. */
async function readPositionWithRetry(owner: `0x${string}`, min: bigint): Promise<bigint> {
  let pos = 0n;
  for (let attempt = 1; attempt <= 6; attempt++) {
    pos = await getAavePosition("USDm", owner);
    if (pos >= min) return pos;
    const delay = 2000 * attempt + Math.floor(Math.random() * 500);
    console.log(`  position read ${formatUnits(pos, 18)} < expected, retrying in ${delay}ms (lagging RPC node?)`);
    await new Promise((r) => setTimeout(r, delay));
  }
  return pos;
}

async function main() {
  await assertCeloMainnet();
  const treasury = orchestratorAccount();
  const apy = await getSupplyApy("USDm");
  console.log(`Aave v3 Celo cUSD(USDm) supply APY: ${apy.toFixed(3)}%`);
  console.log(`plan: supply $2 cUSD from ${treasury.address}, verify aToken, withdraw max. Gas in cUSD.`);

  if (!LIVE) {
    console.log("\nDRY-RUN. Set ALLOW_LIVE_AAVE_SMOKE=true to broadcast.");
    return;
  }

  // idempotent: if a previous run already supplied (e.g. failed on a lagging
  // read), skip straight to the withdraw leg instead of supplying twice.
  const existing = await getAavePosition("USDm", treasury.address);
  if (existing >= parseUnits("1.999", 18)) {
    console.log(`existing aUSDm position ${formatUnits(existing, 18)} — skipping supply leg`);
  } else {
    const supplyHash = await supplyToAave(treasury, "USDm", AMOUNT, {
      agentId: "orchestrator",
      usdValue: 2,
      feeCurrency: FEE_CURRENCIES.USDm,
      rationale:
        `Phase 2 smoke test: supply $2 cUSD to Aave v3 Celo (live APY ${apy.toFixed(3)}%) to prove the ` +
        `yield adapter on mainnet before the swarm uses it. Gas paid in cUSD via CIP-64.`,
    });
    console.log(`supplied: ${explorerTx(supplyHash)}`);
  }

  const pos = await readPositionWithRetry(treasury.address, parseUnits("1.999", 18));
  console.log(`aUSDm position: ${formatUnits(pos, 18)}`);
  if (pos < parseUnits("1.999", 18)) throw new Error("position smaller than supplied amount");

  const withdrawHash = await withdrawFromAave(treasury, "USDm", "max", {
    agentId: "orchestrator",
    usdValue: 2,
    feeCurrency: FEE_CURRENCIES.USDm,
    rationale:
      "Phase 2 smoke test: withdraw the full $2 aUSDm position to prove round-trip works. " +
      "Gas paid in cUSD via CIP-64.",
  });
  console.log(`withdrawn: ${explorerTx(withdrawHash)}`);

  const after = await getAavePosition("USDm", treasury.address);
  console.log(`aUSDm after withdraw: ${formatUnits(after, 18)}`);
  console.log("\nAAVE SMOKE PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
