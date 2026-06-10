/**
 * Aave v3 Celo adapter (Phase 2). Ported from the Mantle adapter
 * (src/aave.ts) with three changes: addresses come from the verified
 * addresses.ts (not env), assets are the Celo stables (USDC/USDT/USDm),
 * and every write supports CIP-64 feeCurrency + budget rails + activity
 * logging.
 */

import { erc20Abi, formatUnits, type Address, type Hex } from "viem";
import type { HDAccount } from "viem/accounts";
import { AAVE_V3, TOKENS, TOKEN_DECIMALS, explorerTx } from "./addresses.js";
import { celoPublicClient, celoWalletClient } from "./chain.js";
import { assertTxAllowed } from "./budget.js";
import { logActivity } from "./activity-log.js";

export type AaveAsset = "USDC" | "USDT" | "USDm";

export const AAVE_ASSETS: Record<AaveAsset, { underlying: Address; aToken: Address; decimals: number }> = {
  USDC: { underlying: TOKENS.USDC, aToken: AAVE_V3.ATOKENS.USDC, decimals: TOKEN_DECIMALS.USDC },
  USDT: { underlying: TOKENS.USDT, aToken: AAVE_V3.ATOKENS.USDT, decimals: TOKEN_DECIMALS.USDT },
  USDm: { underlying: TOKENS.USDm, aToken: AAVE_V3.ATOKENS.USDm, decimals: TOKEN_DECIMALS.USDm },
};

const POOL_ABI = [
  {
    name: "supply",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "configuration", type: "tuple", components: [{ name: "data", type: "uint256" }] },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

const MAX_UINT256 = (1n << 256n) - 1n;

/** Supply APY in percent, read live from currentLiquidityRate (ray, 1e27).
 *  Throws on RPC failure — never returns a fabricated 0 (Mantle audit P3c). */
export async function getSupplyApy(asset: AaveAsset): Promise<number> {
  const data = await celoPublicClient.readContract({
    address: AAVE_V3.POOL,
    abi: POOL_ABI,
    functionName: "getReserveData",
    args: [AAVE_ASSETS[asset].underlying],
  });
  return (Number(data.currentLiquidityRate) / 1e27) * 100;
}

/** aToken balance = supplied principal + accrued interest, in token units. */
export async function getAavePosition(asset: AaveAsset, owner: Address): Promise<bigint> {
  return celoPublicClient.readContract({
    address: AAVE_ASSETS[asset].aToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

export type AaveWriteOptions = {
  agentId: string;
  rationale: string;
  /** USD-equivalent moved, for the budget rail */
  usdValue: number;
  /** CIP-64 fee currency; omit to pay gas in native CELO (fork tests only) */
  feeCurrency?: Address;
};

/** Approve-max once per agent per asset (CLAUDE.md §8), then supply. */
export async function supplyToAave(
  account: HDAccount,
  asset: AaveAsset,
  amount: bigint,
  opts: AaveWriteOptions,
): Promise<Hex> {
  assertTxAllowed(opts.usdValue, `aave supply ${asset}`);
  const { underlying, decimals } = AAVE_ASSETS[asset];
  const wallet = celoWalletClient(account);

  const allowance = await celoPublicClient.readContract({
    address: underlying,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, AAVE_V3.POOL],
  });
  if (allowance < amount) {
    const approveHash = await wallet.writeContract({
      address: underlying,
      abi: erc20Abi,
      functionName: "approve",
      args: [AAVE_V3.POOL, MAX_UINT256],
      feeCurrency: opts.feeCurrency,
    });
    const rcpt = await celoPublicClient.waitForTransactionReceipt({ hash: approveHash });
    if (rcpt.status !== "success") throw new Error(`aave approve reverted ${approveHash}`);
    logActivity({
      agentId: opts.agentId,
      action: "aave-approve",
      rationale: `One-time max approval of ${asset} to the Aave v3 Pool so future supplies don't each need an approval tx (batched per CLAUDE.md §8).`,
      txHash: approveHash,
    });
  }

  const hash = await wallet.writeContract({
    address: AAVE_V3.POOL,
    abi: POOL_ABI,
    functionName: "supply",
    args: [underlying, amount, account.address, 0],
    feeCurrency: opts.feeCurrency,
  });
  const receipt = await celoPublicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`aave supply reverted: ${explorerTx(hash)}`);

  logActivity({
    agentId: opts.agentId,
    action: "aave-supply",
    rationale: opts.rationale,
    txHash: hash,
    asset,
    amount: formatUnits(amount, decimals),
    feeCurrency: opts.feeCurrency,
    gasUsed: receipt.gasUsed.toString(),
  });
  return hash;
}

/** Withdraw `amount`, or the full position when amount is "max". */
export async function withdrawFromAave(
  account: HDAccount,
  asset: AaveAsset,
  amount: bigint | "max",
  opts: AaveWriteOptions,
): Promise<Hex> {
  assertTxAllowed(opts.usdValue, `aave withdraw ${asset}`);
  const { underlying, decimals } = AAVE_ASSETS[asset];
  const wallet = celoWalletClient(account);

  const hash = await wallet.writeContract({
    address: AAVE_V3.POOL,
    abi: POOL_ABI,
    functionName: "withdraw",
    args: [underlying, amount === "max" ? MAX_UINT256 : amount, account.address],
    feeCurrency: opts.feeCurrency,
  });
  const receipt = await celoPublicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`aave withdraw reverted: ${explorerTx(hash)}`);

  logActivity({
    agentId: opts.agentId,
    action: "aave-withdraw",
    rationale: opts.rationale,
    txHash: hash,
    asset,
    amount: amount === "max" ? "max(full position)" : formatUnits(amount, decimals),
    feeCurrency: opts.feeCurrency,
    gasUsed: receipt.gasUsed.toString(),
  });
  return hash;
}
