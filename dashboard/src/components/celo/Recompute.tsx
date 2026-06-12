"use client";

import { useState } from "react";
import { CONTRACTS, explorerAddress } from "@/lib/celo";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="sp-copy"
      data-copied={copied || undefined}
      title="copy full address"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

export function Recompute({ verification }: { verification?: import("@/lib/celo-data").EpochVerification | null }) {
  return (
    <>
      {verification && (
        <div className="sp-verify-badge" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, fontFamily: '"JetBrains Mono", monospace', fontSize: 13 }}>
          <span style={{ color: verification.verified === verification.total ? "#22D3A1" : "#FF5050", fontWeight: 600 }}>
            {verification.verified === verification.total ? "✓" : "✗"} epoch {verification.epoch}: {verification.verified}/{verification.total} scores recomputed &amp; matched onchain calldata
          </span>
          <span style={{ color: "#8892A4" }}>
            — self-verified by the orchestrator after settling, every epoch.{" "}
            <a
              href={`https://github.com/PoulavBhowmick03/spawn-celo/blob/main/docs/epochs/epoch-${verification.epoch}-verification.json`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#4D9EFF" }}
            >
              artifact ↗
            </a>
          </span>
        </div>
      )}
      <div className="sp-verify">
        <pre className="sp-formula">
          <span className="fv">fitness</span>(agent, epoch)   = ((<span className="fv">V_end</span> − <span className="fv">net_flow</span>) / <span className="fv">V_start</span> − 1) × (8760 / <span className="fv">epoch_hours</span>) − <span className="fv">gas_penalty</span>{"\n"}
          <span className="fv">gas_penalty</span>             = (<span className="fv">gas_paid_cUSD</span> / <span className="fv">V_start</span>) × (8760 / <span className="fv">epoch_hours</span>){"\n"}
          <span className="fv">reputation_score</span>        = clamp(round(50 + 500 × (<span className="fv">fitness</span> − <span className="fv">swarm_median</span>)), 0, 100){"\n"}
          {"\n"}
          <span className="fc">V = portfolio value in cUSD via live Mento broker quotes.</span>{"\n"}
          <span className="fc">net_flow = orchestrator funding in/out during the epoch (capital, not P&L).</span>{"\n"}
          <span className="fc">epoch_hours = actual elapsed time between epoch start and settle.</span>{"\n"}
          <span className="fc">Every input is readable on Celoscan. Every score is recomputable.</span>
        </pre>
        <div className="sp-contracts">
          {Object.entries(CONTRACTS).map(([name, addr]) => (
            <div key={name} className="sp-contract-row">
              <span className="cname">{name}</span>
              <span className="caddr">
                {addr.slice(0, 6)}…{addr.slice(-4)}
              </span>
              <CopyButton value={addr} />
              <a className="cgo" href={explorerAddress(addr)} target="_blank" rel="noreferrer">
                ↗
              </a>
            </div>
          ))}
        </div>
      </div>
      <p className="sp-disclaimer">
        Hackathon-grade software. $50 cap, $5/agent, 1% slippage, kill switch enforced in code. Do
        not deposit money you care about.
      </p>
    </>
  );
}
