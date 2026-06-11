/**
 * Signal oracle (Phase 6): the LedgerForge thin slice. Sells a market-signal
 * endpoint via x402 — $0.002 USDC per call, settled onchain via EIP-3009.
 *
 * What buyers get that free riders don't: the oracle samples Mento FX quotes
 * every 5 minutes, so its momentum series has ~50x the resolution of the
 * epoch-boundary momentum non-paying agents compute themselves.
 *
 *   SIGNAL_AGENT_HD_INDEX=30 (wallet + ERC-8004 identity via x402:setup)
 *   npm run signal:serve      # :8402
 */

import "./env.js";
import { createServer } from "node:http";
import { formatUnits, parseUnits } from "viem";
import { TOKENS } from "./addresses.js";
import { quoteSwap } from "./mento.js";
import { getSupplyApy } from "./aave.js";
import { deriveAccount } from "./wallets.js";
import { logActivity } from "./activity-log.js";
import {
  buildRequirements,
  verifyPayment,
  settlePayment,
  SIGNAL_AGENT_HD_INDEX,
  X402_VERSION,
} from "./x402.js";
const PORT = Number(process.env.SIGNAL_PORT ?? 8402);
const SAMPLE_MS = 5 * 60 * 1000;
const RING_MAX = 288; // 24h of 5-min samples

type Sample = { t: number; EURm: number; BRLm: number };
const ring: Sample[] = [];

async function sampleQuotes(): Promise<void> {
  try {
    const one = parseUnits("1", 18);
    const [eur, brl] = await Promise.all([
      quoteSwap(TOKENS.EURm, TOKENS.USDm, one),
      quoteSwap(TOKENS.BRLm, TOKENS.USDm, one),
    ]);
    ring.push({ t: Date.now(), EURm: Number(formatUnits(eur, 18)), BRLm: Number(formatUnits(brl, 18)) });
    if (ring.length > RING_MAX) ring.shift();
  } catch (e) {
    console.warn(`sample failed (FX market closed?): ${(e as Error).message?.slice(0, 80)}`);
  }
}

function momentumBps(leg: "EURm" | "BRLm", windowMs: number): number | null {
  if (ring.length < 2) return null;
  const newest = ring[ring.length - 1];
  const cutoff = newest.t - windowMs;
  const oldest = ring.find((s) => s.t >= cutoff) ?? ring[0];
  if (newest.t === oldest.t) return null;
  return ((newest[leg] - oldest[leg]) / oldest[leg]) * 10_000;
}

async function buildSignal() {
  const [usdcApy, usdtApy, usdmApy] = await Promise.all([
    getSupplyApy("USDC"),
    getSupplyApy("USDT"),
    getSupplyApy("USDm"),
  ]);
  const newest = ring[ring.length - 1];
  return {
    generatedAt: new Date().toISOString(),
    samples: ring.length,
    sampleIntervalMinutes: 5,
    fxUsdPrice: newest ? { EURm: newest.EURm, BRLm: newest.BRLm } : null,
    fxMomentumBps: {
      EURm: { m30: momentumBps("EURm", 30 * 60e3), h2: momentumBps("EURm", 2 * 3600e3), h6: momentumBps("EURm", 6 * 3600e3) },
      BRLm: { m30: momentumBps("BRLm", 30 * 60e3), h2: momentumBps("BRLm", 2 * 3600e3), h6: momentumBps("BRLm", 6 * 3600e3) },
    },
    aaveApyPct: { USDC: usdcApy, USDT: usdtApy, USDm: usdmApy },
    methodology:
      "Mento broker quotes (1-token probes) sampled every 5min; momentum = pct change over window in bps; APYs read live from Aave v3 getReserveData. Recomputable by anyone from public RPC.",
  };
}

async function main() {
  const payee = deriveAccount(SIGNAL_AGENT_HD_INDEX);
  console.log(`signal oracle wallet: ${payee.address} (HD index ${SIGNAL_AGENT_HD_INDEX})`);
  await sampleQuotes();
  setInterval(sampleQuotes, SAMPLE_MS);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    res.setHeader("content-type", "application/json");

    if (url.pathname === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, samples: ring.length, payee: payee.address }));
      return;
    }

    if (url.pathname !== "/signal") {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    // PUBLIC_ORACLE_URL lets external buyers sign payments for the public URL
    // while the swarm routes internally via 127.0.0.1 — the two can differ.
    const publicUrl = process.env.PUBLIC_ORACLE_URL ?? `http://localhost:${PORT}/signal`;
    const requirements = buildRequirements(payee.address, publicUrl);
    const paymentHeader = req.headers["x-payment"];
    if (!paymentHeader || typeof paymentHeader !== "string") {
      res.writeHead(402);
      res.end(JSON.stringify({ x402Version: X402_VERSION, error: "payment required", accepts: [requirements] }));
      return;
    }

    try {
      const payload = await verifyPayment(paymentHeader, requirements);
      const buyer = payload.payload.authorization.from;
      const settlementTx = await settlePayment(payee, payload, buyer);
      const signal = await buildSignal();
      res.setHeader(
        "x-payment-response",
        Buffer.from(JSON.stringify({ success: true, txHash: settlementTx, network: "celo" })).toString("base64"),
      );
      res.writeHead(200);
      res.end(JSON.stringify({ signal, settlementTx }));
      logActivity({
        agentId: "signal-oracle",
        action: "signal-sold",
        rationale: `Sold one market signal (5-min-resolution FX momentum + live Aave APYs) to ${buyer} for $0.002 USDC via x402. Settlement: ${settlementTx}.`,
        txHash: settlementTx,
        buyer,
      });
    } catch (e) {
      res.writeHead(402);
      res.end(JSON.stringify({ x402Version: X402_VERSION, error: (e as Error).message, accepts: [requirements] }));
    }
  });

  // Bind to 0.0.0.0 so Fly.io's proxy can reach the health-check endpoint.
  server.listen(PORT, "0.0.0.0", () => console.log(`signal oracle listening on :${PORT}`));
}

// start only when run directly — importers must not boot a server
if (process.argv[1]?.endsWith("signal-service.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
