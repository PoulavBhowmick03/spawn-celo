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

  const supplyHash = await supplyToAave(treasury, "USDm", AMOUNT, {
    agentId: "orchestrator",
    usdValue: 2,
    feeCurrency: FEE_CURRENCIES.USDm,
    rationale:
      `Phase 2 smoke test: supply $2 cUSD to Aave v3 Celo (live APY ${apy.toFixed(3)}%) to prove the ` +
      `yield adapter on mainnet before the swarm uses it. Gas paid in cUSD via CIP-64.`,
  });
  console.log(`supplied: ${explorerTx(supplyHash)}`);

  const pos = await getAavePosition("USDm", treasury.address);
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
