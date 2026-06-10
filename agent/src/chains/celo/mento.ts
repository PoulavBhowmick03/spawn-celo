/**
 * Mento swap adapter (Phase 2).
 *
 * Wraps @mento-protocol/mento-sdk — never hand-rolls Broker/Router calls
 * (CLAUDE.md §8: exchange routing is the SDK's job; bypassing it means
 * fetching exchangeIds onchain ourselves). The SDK returns ready CallParams;
 * we execute them with CIP-64 feeCurrency so agents pay gas in stablecoins.
 *
 * Every swap goes through the budget rails: per-tx USD cap and the 1%
 * slippage ceiling (MAX_SLIPPAGE_BPS), and is written to the activity log
 * with a rationale.
 */

import { Mento } from "@mento-protocol/mento-sdk";
import { deadlineFromMinutes } from "@mento-protocol/mento-sdk";
import { formatUnits, type Address, type Hex } from "viem";
import type { HDAccount } from "viem/accounts";
import { celoPublicClient, celoWalletClient } from "./chain.js";
import { MAX_SLIPPAGE_BPS, assertTxAllowed } from "./budget.js";
import { logActivity } from "./activity-log.js";
import { CELO_CHAIN_ID, explorerTx } from "./addresses.js";

let mentoSingleton: Mento | undefined;

export async function getMento(): Promise<Mento> {
  if (!mentoSingleton) {
    // SDK's bundled viem PublicClient type lags ours; runtime-compatible.
    mentoSingleton = await Mento.create(
      CELO_CHAIN_ID,
      celoPublicClient as never,
    );
  }
  return mentoSingleton;
}

export type SwapRequest = {
  account: HDAccount;
  agentId: string;
  tokenIn: Address;
  tokenOut: Address;
  /** in tokenIn's smallest unit */
  amountIn: bigint;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  /** USD-equivalent moved, for the budget rail */
  usdValue: number;
  /** CIP-64 fee currency (token or adapter address); omit to pay gas in native CELO (fork tests only) */
  feeCurrency?: Address;
  rationale: string;
};

export type SwapResult = {
  swapTxHash: Hex;
  approvalTxHash?: Hex;
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin: bigint;
};

/** Quote only — no state change. Returns expected amountOut in tokenOut units. */
export async function quoteSwap(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<bigint> {
  const mento = await getMento();
  return (await mento.quotes.getAmountOut(tokenIn, tokenOut, amountIn)) as bigint;
}

/**
 * Execute a swap with approval handling, slippage cap, budget rail, and
 * activity logging. Returns tx hashes and realized amounts.
 */
export async function executeSwap(req: SwapRequest): Promise<SwapResult> {
  assertTxAllowed(req.usdValue, `mento swap ${req.tokenIn}->${req.tokenOut}`);

  const mento = await getMento();
  const wallet = celoWalletClient(req.account);
  const slippagePct = MAX_SLIPPAGE_BPS / 100; // bps -> percent (100 bps = 1%)

  const { approval, swap } = await mento.swap.buildSwapTransaction(
    req.tokenIn,
    req.tokenOut,
    req.amountIn,
    req.account.address,
    req.account.address,
    { slippageTolerance: slippagePct, deadline: deadlineFromMinutes(5) },
  );

  // With CIP-64 the node debits maxFeePerGas*gasLimit from the fee-currency
  // balance during eth_estimateGas simulation; for near-full-balance swaps
  // that makes transferFrom revert at estimation. Explicit gas limits skip
  // estimation entirely.
  const gasOpts = req.feeCurrency ? { gas: 250_000n } : {};
  const swapGasOpts = req.feeCurrency ? { gas: 900_000n } : {};

  let approvalTxHash: Hex | undefined;
  if (approval) {
    approvalTxHash = await wallet.sendTransaction({
      to: approval.to as Address,
      data: approval.data as Hex,
      feeCurrency: req.feeCurrency,
      ...gasOpts,
    });
    const rcpt = await celoPublicClient.waitForTransactionReceipt({
      hash: approvalTxHash,
    });
    if (rcpt.status !== "success") {
      throw new Error(`approval reverted: ${explorerTx(approvalTxHash)}`);
    }
  }

  const swapTxHash = await wallet.sendTransaction({
    to: swap.params.to as Address,
    data: swap.params.data as Hex,
    feeCurrency: req.feeCurrency,
    ...swapGasOpts,
  });
  const receipt = await celoPublicClient.waitForTransactionReceipt({
    hash: swapTxHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`swap reverted: ${explorerTx(swapTxHash)}`);
  }

  logActivity({
    agentId: req.agentId,
    action: "mento-swap",
    rationale: req.rationale,
    txHash: swapTxHash,
    approvalTxHash,
    tokenIn: req.tokenIn,
    tokenOut: req.tokenOut,
    amountIn: formatUnits(req.amountIn, req.tokenInDecimals),
    expectedOut: formatUnits(swap.expectedAmountOut, req.tokenOutDecimals),
    minOut: formatUnits(swap.amountOutMin, req.tokenOutDecimals),
    slippageCapBps: MAX_SLIPPAGE_BPS,
    feeCurrency: req.feeCurrency,
    gasUsed: receipt.gasUsed.toString(),
  });

  return {
    swapTxHash,
    approvalTxHash,
    amountIn: req.amountIn,
    amountOut: swap.expectedAmountOut,
    amountOutMin: swap.amountOutMin,
  };
}
