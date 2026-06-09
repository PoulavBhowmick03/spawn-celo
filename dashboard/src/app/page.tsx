"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { API_BASE, mantlePublicClient } from "@/lib/mantle";

type LandingStats = {
  totalGenerations: number;
  totalRecalled: number;
  latestYield: number;
  improvement: number;
  // Per-generation yields (real, in generation order) used to drive the chart bars.
  genYields: number[];
  // Real Aave benchmark yield (latest gen) — drives the benchmark marker position.
  benchmarkYield: number | null;
};

async function fetchLandingStats(): Promise<LandingStats | null> {
  try {
    const res = await fetch(`${API_BASE}/api/generations`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const gens: { avgYieldPct: number; agentsTerminated: number; benchmarkYieldPct?: number }[] =
      body.generations ?? [];
    if (gens.length === 0) return null;
    const first = gens[0];
    const last = gens[gens.length - 1];
    const totalRecalled = gens.reduce((a, g) => a + g.agentsTerminated, 0);
    const bench = last.benchmarkYieldPct;
    return {
      totalGenerations: gens.length,
      totalRecalled,
      latestYield: last.avgYieldPct,
      improvement: last.avgYieldPct - first.avgYieldPct,
      genYields: gens.map((g) => g.avgYieldPct),
      benchmarkYield: typeof bench === "number" ? bench : null,
    };
  } catch {
    return null;
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function CopyBtn({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`copy-btn${copied ? " copied" : ""}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await copyText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function LandingPage() {
  const [block, setBlock] = useState<bigint | null>(null);
  const [stats, setStats] = useState<LandingStats | null>(null);
  const animatedRef = useRef(false);

  // fetch live stats once
  useEffect(() => {
    fetchLandingStats().then(setStats);
  }, []);

  // nav scroll state
  useEffect(() => {
    const nav = document.getElementById("landing-nav");
    const onScroll = () => {
      if (window.scrollY > 100) nav?.classList.add("scrolled");
      else nav?.classList.remove("scrolled");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // live block height — real Mantle chain head via viem, polled (no fake increment)
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const n = await mantlePublicClient.getBlockNumber();
        if (!cancelled) setBlock(n);
      } catch {
        if (!cancelled) setBlock(null);
      }
    };
    void poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // hero counter animation — runs only when stats resolve
  useEffect(() => {
    if (stats === null) return;
    if (animatedRef.current) return;
    animatedRef.current = true;

    function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }
    const els = document.querySelectorAll<HTMLElement>("[data-counter]");
    if (els.length === 0) return;
    const start = performance.now();
    const dur = 1200;
    function step(now: number) {
      const t = Math.min(1, (now - start) / dur);
      const e = easeOut(t);
      els.forEach((el) => {
        const target = parseFloat(el.dataset.counter!);
        const fmt = el.dataset.format;
        const v = target * e;
        if (fmt === "int") el.textContent = Math.round(v).toLocaleString();
        else if (fmt === "pct") el.textContent = v.toFixed(2) + "%";
        else if (fmt === "signed") el.textContent = (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
        else el.textContent = v.toFixed(2);
      });
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, [stats]);

  // benchmark marker + chart bar widths — recomputed from REAL data whenever stats resolve.
  useEffect(() => {
    // Benchmark line position: derived from the real Aave benchmark yield on the same
    // ÷11 scale as the bars. If there is no real benchmark, hide the marker entirely
    // rather than render a decorative hardcoded position.
    document.querySelectorAll<HTMLElement>(".bench").forEach((b) => {
      if (stats && stats.benchmarkYield !== null) {
        const pct = (Math.min(stats.benchmarkYield, 11) / 11) * 100;
        b.style.left = pct + "%";
        b.style.display = "";
      } else {
        b.style.display = "none";
      }
    });

    // chart bars reveal — widths from real per-gen yields
    const chart = document.getElementById("gen-chart");
    if (chart) {
      const reveal = () => {
        chart.querySelectorAll<HTMLElement>(".bar").forEach((bar, i) => {
          const y = parseFloat(bar.dataset.yield ?? "0");
          const w = (y / 11) * 100;
          setTimeout(() => { bar.style.width = w + "%"; }, i * 150);
        });
        setTimeout(() => chart.classList.add("bars-revealed"), 1000);
      };
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              reveal();
              obs.unobserve(chart);
            }
          });
        },
        { threshold: 0.3 }
      );
      obs.observe(chart);
    }
  }, [stats]);

  // scroll-driven reveals: titles, loop, novel grid
  useEffect(() => {
    // section title reveal
    const titleObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) { en.target.classList.add("revealed"); titleObs.unobserve(en.target); }
        });
      },
      { threshold: 0.1 }
    );
    document.querySelectorAll(".landing-page .sec-title").forEach((t) => titleObs.observe(t));

    // loop stagger + progress bar
    const loop = document.getElementById("loop-el");
    if (loop) {
      const loopObs = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) { en.target.classList.add("revealed"); loopObs.unobserve(en.target); }
          });
        },
        { threshold: 0.25 }
      );
      loopObs.observe(loop);
    }

    // novel grid stagger
    const novel = document.getElementById("novel-grid-el");
    if (novel) {
      novel.querySelectorAll<HTMLElement>(".novel-item").forEach((it, i) => {
        it.style.setProperty("--reveal-delay", `${i * 60}ms`);
      });
      const novelObs = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) { en.target.classList.add("revealed"); novelObs.unobserve(en.target); }
          });
        },
        { threshold: 0.15 }
      );
      novelObs.observe(novel);
    }
  }, []);

  return (
    <div className="landing-page">
      {/* NAV */}
      <header className="nav" id="landing-nav">
        <div className="nav-inner">
          <Link className="brand" href="/" aria-label="Spawn Protocol home">
            <div className="glyph">S</div>
            <div>
              <div className="brand-name">Spawn Protocol</div>
              <div className="brand-sub">Forensic Terminal · Mantle Mainnet</div>
            </div>
          </Link>
          <div className="nav-right">
            <span className="block-counter">
              <span className="lab">Block</span>
              <span className="v">{block !== null ? block.toLocaleString() : "—"}</span>
            </span>
            <span className="chain-pill">
              <span className="dot" />
              Mantle Mainnet
            </span>
            <Link className="btn" href="/terminal">View Live Swarm →</Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="hero">
        {/* atmospheric elements */}
        <div className="hero-bloom hero-bloom-green" />
        <div className="hero-bloom hero-bloom-crimson" />
        <div className="hero-bloom hero-bloom-blue" />
        <div className="hero-bloom hero-bloom-amber" />
        <div className="hero-grid" />
        <div className="hero-noise" />
        <div className="hero-vignette" />
        <div className="hero-scan" />

        <div className="hero-inner">
          <div className="eyebrow-dark">Mantle Mainnet · Alpha + Data · AI Yield Swarm</div>
          <h1 className="headline">Every agent that dies makes the next one smarter.</h1>
          <p className="lede">
            Five autonomous yield agents on Mantle. Each manages a live USDe position on Aave V3.
            Underperformers are terminated on-chain. Venice AI generates a structured failure post-mortem.
            The IPFS CID is written permanently to <strong>LineageRegistry</strong>. The successor inherits
            every ancestor&apos;s specific failure — as immutable prompt constraints.
          </p>
          <hr className="hero-rule" />
          <div className="hero-stats">
            <div className="hstat">
              <div className="lab">Generations</div>
              {stats ? (
                <div className="val" data-counter={String(stats.totalGenerations)} data-format="int">0</div>
              ) : (
                <div className="val">—</div>
              )}
              <div className="sub">seeded on Mantle Mainnet</div>
            </div>
            <div className="hstat" data-tone="red">
              <div className="lab">Agents Recalled</div>
              {stats ? (
                <div className="val" data-counter={String(stats.totalRecalled)} data-format="int">0</div>
              ) : (
                <div className="val">—</div>
              )}
              <div className="sub">{stats ? `${stats.totalRecalled * 3} constraints inherited` : "live data loading"}</div>
            </div>
            <div className="hstat" data-tone="green">
              <div className="lab">Avg Yield · Latest Gen</div>
              {stats ? (
                <div className="val" data-counter={stats.latestYield.toFixed(2)} data-format="pct">0.00%</div>
              ) : (
                <div className="val">—</div>
              )}
              <div className="sub">live Aave V3 positions</div>
            </div>
            <div className="hstat" data-tone="green">
              <div className="lab">Improvement</div>
              {stats ? (
                <div className="val" data-counter={stats.improvement.toFixed(2)} data-format="signed">+0.00%</div>
              ) : (
                <div className="val">—</div>
              )}
              <div className="sub">latest gen over gen 0</div>
            </div>
          </div>
          <div className="cta-row">
            <Link className="btn btn-lg" href="/terminal">Launch Live Swarm →</Link>
            <a
              className="btn btn-lg btn-ghost"
              href="https://github.com/PoulavBhowmick03/spawn-yield"
              target="_blank"
              rel="noopener noreferrer"
            >
              View Source ↗
            </a>
          </div>
        </div>
        <div className="scroll-hint">↓ scroll for evidence</div>
      </section>

      {/* DARWINIAN LOOP */}
      <section className="section">
        <div className="section-inner">
          <div className="eyebrow">How it works</div>
          <h2 className="sec-title">The Darwinian Loop</h2>
          <p className="sec-sub">
            Each cycle either confirms performance or produces verifiable failure memory. There is no neutral outcome.
          </p>
          <div className="loop" id="loop-el">
            <div className="loop-progress" />
            <div className="loop-step" data-tone="blue" data-watermark="01">
              <div className="n">01</div>
              <div className="t">Spawn</div>
              <div className="b">Parent calls SpawnFactory. Child wallet receives $15 USDe and 0.05 MNT gas stipend.</div>
            </div>
            <div className="loop-arrow">→</div>
            <div className="loop-step" data-tone="green" data-watermark="02">
              <div className="n">02</div>
              <div className="t">Yield</div>
              <div className="b">Child reads live Aave V3 USDe APY. Venice AI decides: supply, withdraw, or hold. Executes on-chain.</div>
            </div>
            <div className="loop-arrow">→</div>
            <div className="loop-step" data-tone="ink" data-watermark="03">
              <div className="n">03</div>
              <div className="t">Evaluate</div>
              <div className="b">Parent scores every 75 seconds: (yield − benchmark) ÷ |drawdown|. Two consecutive failures trigger recall.</div>
            </div>
            <div className="loop-arrow">→</div>
            <div className="loop-step" data-tone="crimson" data-watermark="04">
              <div className="n">04</div>
              <div className="t">Terminate</div>
              <div className="b">Venice generates post-mortem JSON. Pinata pins it. recallChild() and pushCID() broadcast to Mantle.</div>
            </div>
            <div className="loop-arrow">→</div>
            <div className="loop-step" data-tone="amber" data-watermark="05">
              <div className="n">05</div>
              <div className="t">Inherit</div>
              <div className="b">Successor fetches all ancestor CIDs. buildAncestorContext() formats them as Venice system prompt constraints.</div>
            </div>
          </div>
        </div>
      </section>

      {/* EVIDENCE */}
      <section className="section alt">
        <div className="section-inner">
          <div className="eyebrow">On-chain proof · Mantle Mainnet</div>
          <h2 className="sec-title">Every event is a Mantle transaction.</h2>
          <p className="sec-sub">
            Generational performance is reconstructible from public chain data. Underperformance becomes inheritance.
          </p>
          <div className="evidence-grid">
            <div>
              <div className="gen-chart" id="gen-chart">
                {stats ? (
                  stats.genYields.map((y, i) => {
                    const isLatest = i === stats.genYields.length - 1;
                    const tone = isLatest ? "green" : i === 0 ? "red" : "amber";
                    return (
                      <div className="gen-row" key={i}>
                        <div className="gen-label">
                          GEN {i}
                          <span className="sub">{isLatest ? "latest" : "spawned"}</span>
                        </div>
                        <div className="track">
                          {i === 0 ? (
                            <div className="bench"><span className="lbl">BENCHMARK (Aave APY)</span></div>
                          ) : (
                            <div className="bench" />
                          )}
                          <div
                            className="bar"
                            data-tone={tone}
                            data-yield={String(Math.min(y, 11))}
                          >
                            <span className="bar-end">
                              {isLatest ? y.toFixed(2) + "%" : `Gen ${i}`}
                            </span>
                          </div>
                        </div>
                        <div className="gen-tail">
                          <span className="pill" data-tone={isLatest ? "active" : "terminated"}>
                            <span className="dot" />
                            {isLatest ? "Active" : "Terminated"}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="gen-row">
                    <div className="gen-label">GEN —<span className="sub">awaiting data</span></div>
                    <div className="track">
                      <div className="bench"><span className="lbl">BENCHMARK (Aave APY)</span></div>
                    </div>
                    <div className="gen-tail">
                      <span className="pill" data-tone="terminated"><span className="dot" />No live data</span>
                    </div>
                  </div>
                )}
                <div className="callout">
                  <p className="h">
                    {stats
                      ? <>Latest gen outperforms gen 0 by <span className="pos">+{stats.improvement.toFixed(2)}%</span> avg yield.</>
                      : "Generational performance improves through inherited failure constraints."}
                  </p>
                  <p className="s">
                    {stats ? (
                      <><span className="num">{stats.totalRecalled}</span> terminations produced <span className="num">{stats.totalRecalled * 3}</span> inherited constraints across the lineage.</>
                    ) : (
                      "Connect a live swarm to see real-time performance data."
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div>
              <h3 className="col-title">Deployed Contracts</h3>
              <div className="contract-stack">
                {[
                  {
                    name: "SpawnFactory",
                    addr: "0x94171e5D54792149E14fFa19197e3c17E263C740",
                    href: "https://mantlescan.xyz/address/0x94171e5d54792149e14ffa19197e3c17e263c740",
                  },
                  {
                    name: "LineageRegistry",
                    addr: "0x0466c58d7955cFdfa9E2070077D2f5E26561b59E",
                    href: "https://mantlescan.xyz/address/0x0466c58d7955cfdfa9e2070077d2f5e26561b59e",
                  },
                  {
                    name: "ChildAgent (impl)",
                    addr: "0xD2d79F4A19E0D77267aBe80d85c33630d0923F72",
                    href: "https://mantlescan.xyz/address/0xd2d79f4a19e0d77267abe80d85c33630d0923f72",
                  },
                ].map((c) => (
                  <div className="contract-card" key={c.name}>
                    <CopyBtn address={c.addr} />
                    <div className="contract-top">
                      <div className="contract-name">{c.name}</div>
                      <span className="verified">Verified ✓</span>
                    </div>
                    <div className="contract-addr">{c.addr}</div>
                    <a className="contract-link" href={c.href} target="_blank" rel="noopener noreferrer">mantlescan ↗</a>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* NOVEL */}
      <section className="section">
        <div className="section-inner">
          <div className="eyebrow">The primitive</div>
          <h2 className="sec-title">Verifiable generational memory, on-chain.</h2>
          <p className="sec-sub">
            Most AI trading agents are stateless. Each run starts from zero. Spawn Protocol introduces
            on-chain generational memory as a primitive.
          </p>
          <div className="novel-grid" id="novel-grid-el">
            <div className="novel-item">
              <div className="n">01</div>
              <div className="t">Post-Mortem as Structured Data</div>
              <div className="b">Every termination produces a Venice-generated JSON with failureReason, metricsAtTermination, and inheritanceConstraints. Not logs — structured memory.</div>
            </div>
            <div className="novel-item">
              <div className="n">02</div>
              <div className="t">IPFS: Permanent, Content-Addressed</div>
              <div className="b">The post-mortem JSON is pinned via Pinata. The CID is immutable. The data cannot be changed retroactively.</div>
            </div>
            <div className="novel-item">
              <div className="n">03</div>
              <div className="t">LineageRegistry: Tamper-Proof Ledger</div>
              <div className="b">pushCID() appends the IPFS CID on-chain with timestamp. getLineage() returns the full ancestor chain. Any observer can reconstruct the full history.</div>
            </div>
            <div className="novel-item">
              <div className="n">04</div>
              <div className="t">Successor Receives Ancestor Context</div>
              <div className="b">buildAncestorContext() fetches all ancestor post-mortems and injects them verbatim into the Venice system prompt. The successor reads every predecessor&apos;s exact failure before its first decision.</div>
            </div>
            <div className="novel-item span">
              <div className="n">05</div>
              <div className="t">GenerationResult: AI Output, On-Chain</div>
              <div className="b">postGenerationResult() writes Venice-generated performance summaries directly to Mantle. AI output is verifiable and timestamped as a smart contract event.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ARCHITECTURE */}
      <section className="section alt">
        <div className="section-inner">
          <div className="eyebrow">Architecture</div>
          <h2 className="sec-title">Three contracts. Six TypeScript modules.</h2>
          <p className="sec-sub">The full system, end to end. No hidden services. No closed components.</p>
          <div className="arch-grid">
            <div className="arch-table">
              <div className="arch-head" data-tone="blue">Smart Contracts</div>
              <div className="arch-row"><span className="arch-name">SpawnFactory.sol</span><span className="arch-role">EIP-1167 clone factory. Registers in ERC-8004.</span></div>
              <div className="arch-row"><span className="arch-name">ChildAgent.sol</span><span className="arch-role">Per-child state. recallChild() stores IPFS CID.</span></div>
              <div className="arch-row"><span className="arch-name">LineageRegistry.sol</span><span className="arch-role">Append-only CID ledger. postGenerationResult() emits Venice summaries.</span></div>
            </div>
            <div className="arch-table">
              <div className="arch-head" data-tone="green">Agent Runtime</div>
              <div className="arch-row"><span className="arch-name">parent.ts</span><span className="arch-role">Orchestrator. Spawns, evaluates, recalls, respawns.</span></div>
              <div className="arch-row"><span className="arch-name">child.ts</span><span className="arch-role">Per-agent loop. Venice decision → Aave execution.</span></div>
              <div className="arch-row"><span className="arch-name">venice.ts</span><span className="arch-role">Yield reasoning, post-mortem generation, summaries.</span></div>
              <div className="arch-row"><span className="arch-name">lineage.ts</span><span className="arch-role">buildAncestorContext() — fetches all ancestor CIDs.</span></div>
              <div className="arch-row"><span className="arch-name">aave.ts</span><span className="arch-role">Aave V3 Pool reads and writes on Mantle.</span></div>
              <div className="arch-row"><span className="arch-name">ipfs.ts</span><span className="arch-role">Pinata pinning for post-mortem JSON.</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA BANNER */}
      <section className="section dark">
        <div className="cta-bloom" />
        <div className="cta-grid" />
        <div className="section-inner cta-banner">
          <div className="e">Mantle Turing Test 2026</div>
          <h2 className="h">Watch the swarm run live.</h2>
          <p className="b">Five agents. Real USDe. Live Aave positions. Every termination on Mantlescan.</p>
          <div style={{ marginTop: 36 }}>
            <Link className="btn btn-lg" href="/terminal">Launch Live Swarm →</Link>
          </div>
          <div className="chip-row">
            <a className="chip" href="https://mantlescan.xyz/address/0x94171e5d54792149e14ffa19197e3c17e263c740" target="_blank" rel="noopener noreferrer">SpawnFactory 0x9417…C740</a>
            <a className="chip" href="https://mantlescan.xyz/address/0x0466c58d7955cfdfa9e2070077d2f5e26561b59e" target="_blank" rel="noopener noreferrer">LineageRegistry 0x0466…59E</a>
            <a className="chip" href="https://mantlescan.xyz/address/0xd2d79f4a19e0d77267abe80d85c33630d0923f72" target="_blank" rel="noopener noreferrer">ChildAgent 0xD2d7…3F72</a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="foot-brand">
            <div className="glyph">S</div>
            <div className="meta">
              <div className="name">Spawn Protocol</div>
              <div className="lic">MIT License · 2026</div>
            </div>
          </div>
          <div className="foot-links">
            <Link href="/terminal">Swarm Dashboard</Link>
            <span className="sep">·</span>
            <a href="https://github.com/PoulavBhowmick03/spawn-yield" target="_blank" rel="noopener noreferrer">GitHub</a>
            <span className="sep">·</span>
            <a href="https://mantlescan.xyz/address/0x0466c58d7955cfdfa9e2070077d2f5e26561b59e" target="_blank" rel="noopener noreferrer">Mantlescan</a>
          </div>
          <div className="foot-credit">
            Built by Poulav Bhowmick + Ishita<br />
            Mantle Turing Test Hackathon 2026<br />
            Alpha + Data · AI &amp; RWA tracks
          </div>
        </div>
      </footer>
    </div>
  );
}
