/**
 * Swarm status: fitness table, balances, links. Read-only.
 *   npm run swarm:status
 */

import "./env.js";
import { formatUnits } from "viem";
import { explorerAddress, SCAN_8004 } from "./addresses.js";
import { snapshotMarket } from "./market.js";
import { readPortfolio } from "./portfolio.js";
import { loadState } from "./swarm-state.js";
import { orchestratorAccount } from "./wallets.js";
import { celoPublicClient } from "./chain.js";
import { erc20Abi } from "viem";
import { TOKENS } from "./addresses.js";

async function main() {
  const state = loadState();
  if (!state) {
    console.log("no swarm state yet — swarm has not been started");
    return;
  }
  const ctx = await snapshotMarket(state.prevFxUsdPrice ? { fxUsdPrice: state.prevFxUsdPrice } : undefined);

  console.log(`epoch ${state.epochNumber} (started ${state.epochStartedAt ?? "—"})`);
  console.log(
    `market: EURm $${ctx.fxUsdPrice.EURm.toFixed(4)} (${ctx.fxMomentumBps.EURm.toFixed(1)}bps), ` +
      `BRLm $${ctx.fxUsdPrice.BRLm.toFixed(4)} (${ctx.fxMomentumBps.BRLm.toFixed(1)}bps) | ` +
      `Aave APY: USDC ${ctx.aaveApyPct.USDC.toFixed(2)}% USDT ${ctx.aaveApyPct.USDT.toFixed(2)}% cUSD ${ctx.aaveApyPct.USDm.toFixed(2)}%`,
  );

  const treasury = orchestratorAccount();
  const tBal = await celoPublicClient.readContract({
    address: TOKENS.USDm, abi: erc20Abi, functionName: "balanceOf", args: [treasury.address],
  });
  console.log(`treasury: $${Number(formatUnits(tBal, 18)).toFixed(2)} cUSD (${treasury.address})\n`);

  const header = ["agent", "8004", "gen", "status", "value", "vStart", "lastFit", "lastScore"];
  console.log(header.join("\t"));
  for (const a of state.agents) {
    const pf = a.status === "ACTIVE" ? await readPortfolio(a.address, ctx) : undefined;
    const last = a.history[a.history.length - 1];
    console.log(
      [
        a.slug,
        `#${a.erc8004AgentId}`,
        a.generation,
        a.status,
        pf ? `$${pf.totalUsd.toFixed(3)}` : "—",
        a.vStartUsd !== undefined ? `$${a.vStartUsd.toFixed(3)}` : "—",
        last ? last.fitness.toFixed(3) : "—",
        last ? last.score : "—",
      ].join("\t"),
    );
  }
  console.log(`\nlinks: ${SCAN_8004}/agents/celo · ${explorerAddress(treasury.address)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
