/**
 * Action executor: turns strategy intents into mainnet transactions through
 * the budget-railed adapters, records an onchain decision proof per action
 * on the agent's ChildAgent clone (recordDecisionHash), and accounts the
 * gas each agent spends (in cUSD) for the fitness gas penalty.
 */

import { erc20Abi, formatUnits, keccak256, toBytes, type Address, type Hex } from "viem";
import type { HDAccount } from "viem/accounts";
import { FEE_CURRENCIES, TOKENS, TOKEN_DECIMALS } from "./addresses.js";
import { celoPublicClient, celoWalletClient, maybeFee } from "./chain.js";
import { executeSwap } from "./mento.js";
import { supplyToAave, withdrawFromAave } from "./aave.js";
import type { Action } from "./strategies.js";
import type { SwarmAgentState } from "./swarm-state.js";
import { logActivity } from "./activity-log.js";

const CHILD_AGENT_ABI = [
  {
    name: "recordDecisionHash",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "actionType", type: "string" },
      { name: "amountBps", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

async function gasUsdOf(txHash: Hex): Promise<number> {
  const r = await celoPublicClient.getTransactionReceipt({ hash: txHash });
  // CIP-64: effectiveGasPrice is denominated in the tx's fee currency (cUSD, 18 dec)
  return Number(formatUnits(r.gasUsed * r.effectiveGasPrice, 18));
}

function feeCurrencyFor(token: keyof typeof TOKENS): Address | undefined {
  if (token === "USDC") return maybeFee(FEE_CURRENCIES.USDC_ADAPTER);
  if (token === "USDT") return maybeFee(FEE_CURRENCIES.USDT_ADAPTER);
  return maybeFee(TOKENS[token]); // USDm/EURm/BRLm are direct fee currencies
}

export type ExecutionResult = {
  txHashes: Hex[];
  gasUsd: number;
  executed: number;
  held: number;
};

export async function executeActions(
  agent: SwarmAgentState,
  account: HDAccount,
  orchestrator: HDAccount,
  actions: Action[],
  epochNumber: number,
): Promise<ExecutionResult> {
  const txHashes: Hex[] = [];
  let gasUsd = 0;
  let executed = 0;
  let held = 0;

  for (const action of actions) {
    if (action.kind === "hold") {
      held++;
      logActivity({
        agentId: agent.slug,
        action: "hold",
        rationale: `Epoch ${epochNumber}: ${action.reason}`,
      });
      continue;
    }

    try {
    let txHash: Hex;
    if (action.kind === "mento-swap") {
      // -1n placeholder = full live balance of tokenIn at execution time.
      // Always clamp to the live balance: strategy amounts round-trip through
      // JS floats and can exceed the true balance by a few wei, which makes
      // the router's transferFrom revert.
      const balance = await celoPublicClient.readContract({
        address: TOKENS[action.tokenIn],
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      let amountIn = action.amountIn === -1n || action.amountIn > balance ? balance : action.amountIn;
      // Gas for this swap is debited from the SAME token (CIP-64): keep a
      // fee headroom in the wallet or transferFrom(amountIn) can't cover.
      const feeToken = feeCurrencyFor(action.tokenIn);
      if (feeToken && (feeToken === TOKENS[action.tokenIn] || action.tokenIn === "USDC" || action.tokenIn === "USDT")) {
        const headroom = TOKEN_DECIMALS[action.tokenIn] === 6 ? 60_000n : 60_000_000_000_000_000n; // ~$0.06
        amountIn = amountIn + headroom > balance ? balance - headroom : amountIn;
      }
      if (amountIn <= 0n) continue;
      const res = await executeSwap({
        account,
        agentId: agent.slug,
        tokenIn: TOKENS[action.tokenIn],
        tokenOut: TOKENS[action.tokenOut],
        amountIn,
        tokenInDecimals: TOKEN_DECIMALS[action.tokenIn],
        tokenOutDecimals: TOKEN_DECIMALS[action.tokenOut],
        usdValue: action.usdValue,
        feeCurrency: feeCurrencyFor(action.tokenIn),
        rationale: `Epoch ${epochNumber} ${agent.strategy}: ${action.reason}`,
      });
      txHash = res.swapTxHash;
      if (res.approvalTxHash) {
        txHashes.push(res.approvalTxHash);
        gasUsd += await gasUsdOf(res.approvalTxHash);
      }
    } else if (action.kind === "aave-supply") {
      const balance = await celoPublicClient.readContract({
        address: TOKENS[action.asset],
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      const amount = action.amount === -1n || action.amount > balance ? balance : action.amount;
      if (amount === 0n) continue;
      txHash = await supplyToAave(account, action.asset, amount, {
        agentId: agent.slug,
        usdValue: action.usdValue,
        feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
        rationale: `Epoch ${epochNumber} ${agent.strategy}: ${action.reason}`,
      });
    } else {
      txHash = await withdrawFromAave(account, action.asset, action.amount, {
        agentId: agent.slug,
        usdValue: action.usdValue,
        feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
        rationale: `Epoch ${epochNumber} ${agent.strategy}: ${action.reason}`,
      });
    }

    txHashes.push(txHash);
    gasUsd += await gasUsdOf(txHash);
    executed++;

    // onchain decision proof on the agent's ChildAgent clone (parent = orchestrator)
    if (agent.childContract) {
      const payload = JSON.stringify({
        epoch: epochNumber,
        agent: agent.slug,
        action: { ...action, amountIn: undefined, amount: undefined },
        executionTx: txHash,
      });
      const bps = Math.min(10_000, Math.round((action.usdValue / Math.max(agent.vStartUsd ?? 5, 0.01)) * 10_000));
      const orchWallet = celoWalletClient(orchestrator);
      const proofTx = await orchWallet.writeContract({
        address: agent.childContract,
        abi: CHILD_AGENT_ABI,
        functionName: "recordDecisionHash",
        args: [keccak256(toBytes(payload)), action.kind, BigInt(bps)],
        feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
      });
      await celoPublicClient.waitForTransactionReceipt({ hash: proofTx });
      txHashes.push(proofTx);
      logActivity({
        agentId: agent.slug,
        action: "decision-proof",
        rationale: `Epoch ${epochNumber}: commit keccak hash of the ${action.kind} decision payload to ${agent.slug}'s ChildAgent contract so the decision that produced tx ${txHash} is provable onchain.`,
        txHash: proofTx,
        provenTx: txHash,
        payload,
      });
    }
    } catch (e) {
      // one failing action (e.g. FXMarketClosed on a weekend) must not kill
      // the epoch for this agent or the swarm — log it and move on.
      console.warn(`  ${agent.slug}: action ${action.kind} failed — ${(e as Error).message?.slice(0, 120)}`);
      logActivity({
        agentId: agent.slug,
        action: "action-failed",
        rationale: `Epoch ${epochNumber}: intended ${action.kind} (${action.reason}) could not execute: ${(e as Error).message?.slice(0, 200)}. Continuing; the strategy will re-evaluate next epoch.`,
      });
    }
  }

  return { txHashes, gasUsd, executed, held };
}
