/**
 * Standalone kill switch: unwind every ACTIVE agent's portfolio back to the
 * treasury and mark the epoch state. Same code path the SIGINT handler uses.
 *   ALLOW_LIVE_SWARM=true npm run swarm:unwind
 */

import "./env.js";
import { formatUnits } from "viem";
import { assertCeloMainnet } from "./chain.js";
import { deriveAccount, orchestratorAccount } from "./wallets.js";
import { loadState, saveState } from "./swarm-state.js";
import { unwindAgentToTreasury } from "./unwind.js";
import { publishDocs } from "./epoch.js";

const LIVE = /^(1|true|yes)$/i.test(process.env.ALLOW_LIVE_SWARM ?? "");

async function main() {
  await assertCeloMainnet();
  const state = loadState();
  if (!state) throw new Error("no swarm state");
  const treasury = orchestratorAccount();
  const active = state.agents.filter((a) => a.status === "ACTIVE");
  console.log(`unwinding ${active.length} active agents to ${treasury.address}`);
  if (!LIVE) {
    console.log("DRY-RUN. Set ALLOW_LIVE_SWARM=true to execute.");
    return;
  }
  for (const agent of active) {
    const res = await unwindAgentToTreasury(
      deriveAccount(agent.hdIndex),
      agent.slug,
      treasury.address,
      "manual swarm:unwind (kill switch)",
    );
    console.log(`  ${agent.slug}: swept ${formatUnits(res.sweptUsdm, 18)} cUSD in ${res.txHashes.length} txs`);
  }
  saveState(state);
  publishDocs("chore(swarm): manual unwind state");
  console.log("done — all funds home. Re-run swarm:start to redeploy.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
