/**
 * Portfolio valuation: an agent's holdings marked in cUSD using the same
 * Mento quotes a third party can fetch — this is V_start/V_end for the
 * published fitness formula.
 */

import { erc20Abi, formatUnits, type Address } from "viem";
import { TOKENS, TOKEN_DECIMALS } from "./addresses.js";
import { celoPublicClient } from "./chain.js";
import { getAavePosition, type AaveAsset } from "./aave.js";
import type { MarketContext, FxLeg } from "./market.js";

export type Portfolio = {
  /** wallet balances in token units */
  wallet: Partial<Record<keyof typeof TOKENS, bigint>>;
  /** aToken balances in token units */
  aave: Partial<Record<AaveAsset, bigint>>;
  /** total marked in cUSD */
  totalUsd: number;
};

const WALLET_TOKENS: (keyof typeof TOKENS)[] = ["USDm", "EURm", "BRLm", "USDC", "USDT"];
const AAVE_ASSETS_LIST: AaveAsset[] = ["USDC", "USDT", "USDm"];

function tokenUsd(symbol: keyof typeof TOKENS, amount: bigint, ctx: MarketContext): number {
  const units = Number(formatUnits(amount, TOKEN_DECIMALS[symbol]));
  if (symbol === "EURm" || symbol === "BRLm") return units * ctx.fxUsdPrice[symbol as FxLeg];
  return units; // USDm/USDC/USDT marked 1:1 (USD stables)
}

export async function readPortfolio(owner: Address, ctx: MarketContext): Promise<Portfolio> {
  const wallet: Portfolio["wallet"] = {};
  for (const sym of WALLET_TOKENS) {
    wallet[sym] = await celoPublicClient.readContract({
      address: TOKENS[sym] as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
    });
  }
  const aave: Portfolio["aave"] = {};
  for (const asset of AAVE_ASSETS_LIST) {
    aave[asset] = await getAavePosition(asset, owner);
  }

  let totalUsd = 0;
  for (const sym of WALLET_TOKENS) totalUsd += tokenUsd(sym, wallet[sym] ?? 0n, ctx);
  for (const asset of AAVE_ASSETS_LIST) totalUsd += tokenUsd(asset, aave[asset] ?? 0n, ctx);

  return { wallet, aave, totalUsd };
}
