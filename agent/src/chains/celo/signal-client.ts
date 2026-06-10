/**
 * x402 client (Phase 6): swarm agents with useSignal=true buy one market
 * signal before each evaluate(). Standard x402 flow: GET -> 402 with
 * requirements -> sign EIP-3009 authorization -> retry with X-PAYMENT.
 */

import type { HDAccount } from "viem/accounts";
import { logActivity } from "./activity-log.js";
import { signPayment, type PaymentRequirements } from "./x402.js";

const SIGNAL_URL = process.env.SIGNAL_URL ?? "http://127.0.0.1:8402/signal";

export type MarketSignal = {
  generatedAt: string;
  samples: number;
  fxUsdPrice: { EURm: number; BRLm: number } | null;
  fxMomentumBps: {
    EURm: { m30: number | null; h2: number | null; h6: number | null };
    BRLm: { m30: number | null; h2: number | null; h6: number | null };
  };
  aaveApyPct: { USDC: number; USDT: number; USDm: number };
};

export async function buySignal(
  account: HDAccount,
  agentSlug: string,
): Promise<{ signal: MarketSignal; settlementTx: string } | null> {
  try {
    // 1. unauthenticated request -> 402 + payment requirements
    const probe = await fetch(SIGNAL_URL, { signal: AbortSignal.timeout(10_000) });
    if (probe.status !== 402) {
      if (probe.ok) return (await probe.json()) as never; // free? take it
      throw new Error(`unexpected status ${probe.status}`);
    }
    const { accepts } = (await probe.json()) as { accepts: PaymentRequirements[] };
    const req = accepts?.[0];
    if (!req || req.scheme !== "exact") throw new Error("no usable payment scheme offered");

    // 2. sign the EIP-3009 authorization and retry
    const header = await signPayment(account, req);
    const paid = await fetch(SIGNAL_URL, {
      headers: { "x-payment": header },
      signal: AbortSignal.timeout(120_000), // settlement happens inline
    });
    if (!paid.ok) {
      const body = await paid.text();
      throw new Error(`payment rejected (${paid.status}): ${body.slice(0, 150)}`);
    }
    const body = (await paid.json()) as { signal: MarketSignal; settlementTx: string };

    logActivity({
      agentId: agentSlug,
      action: "x402-signal-purchase",
      rationale: `Bought one market signal from the signal oracle for $0.002 USDC via x402 (EIP-3009 authorization signed by this agent; settlement tx ${body.settlementTx}). The 5-min-resolution FX momentum informs this epoch's strategy evaluation.`,
      txHash: body.settlementTx as `0x${string}`,
    });
    return body;
  } catch (e) {
    console.warn(`  ${agentSlug}: signal purchase failed (${(e as Error).message?.slice(0, 100)}) — evaluating without signal`);
    logActivity({
      agentId: agentSlug,
      action: "x402-signal-unavailable",
      rationale: `Signal purchase failed (${(e as Error).message?.slice(0, 120)}); proceeding with epoch-boundary momentum only.`,
    });
    return null;
  }
}
