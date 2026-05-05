"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export function Navbar() {
  const [clock, setClock] = useState("--:--:-- UTC");
  const [block, setBlock] = useState(76_418_902);

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
    const blockId = setInterval(() => setBlock((b) => b + 1), 2400);
    return () => {
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
        <nav className="site-nav" aria-label="Primary">
          <Link href="/">Landing</Link>
          <Link href="/terminal">Terminal</Link>
          <Link href="/judge-flow">Judge Flow</Link>
          <Link href="/lineage">Lineage</Link>
        </nav>
        <div className="meta-bar">
          <span>
            <span className="live-dot" />
            LIVE
          </span>
          <span>
            BLOCK <span className="v">{block.toLocaleString()}</span>
          </span>
          <span className="v">{clock}</span>
        </div>
      </header>
    </div>
  );
}
