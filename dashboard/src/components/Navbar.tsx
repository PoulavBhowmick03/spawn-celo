"use client";

import { useEffect, useState } from "react";
import { mantlePublicClient } from "@/lib/mantle";

export function Navbar() {
  const [clock, setClock] = useState("--:--:-- UTC");
  // Real Mantle chain head (null until first successful read / on RPC failure).
  const [block, setBlock] = useState<bigint | null>(null);

  useEffect(() => {
    const tickClock = () => {
      const d = new Date();
      const h = String(d.getUTCHours()).padStart(2, "0");
      const m = String(d.getUTCMinutes()).padStart(2, "0");
      const s = String(d.getUTCSeconds()).padStart(2, "0");
      setClock(`${h}:${m}:${s} UTC`);
    };
    tickClock();
    const clockId = setInterval(tickClock, 1000);

    let cancelled = false;
    const pollBlock = async () => {
      try {
        const n = await mantlePublicClient.getBlockNumber();
        if (!cancelled) setBlock(n);
      } catch {
        if (!cancelled) setBlock(null);
      }
    };
    void pollBlock();
    const blockId = setInterval(pollBlock, 5000);

    return () => {
      cancelled = true;
      clearInterval(clockId);
      clearInterval(blockId);
    };
  }, []);

  return (
    <div className="shell" style={{ paddingBottom: 0 }}>
      <header className="masthead">
        <div className="brand">
          <div className="glyph">S</div>
          <div className="brand-text">
            <div className="brand-name">Spawn Protocol</div>
            <div className="brand-sub">Forensic Terminal · Mantle Mainnet</div>
          </div>
        </div>
        <div className="meta-bar">
          <span>
            <span className="live-dot" />
            LIVE
          </span>
          <span>
            BLOCK <span className="v">{block !== null ? block.toLocaleString() : "—"}</span>
          </span>
          <span className="v">{clock}</span>
        </div>
      </header>
    </div>
  );
}
