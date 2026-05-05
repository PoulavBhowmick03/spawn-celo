"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  const [block, setBlock] = useState(76_418_902);

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

  // live block counter
  useEffect(() => {
    const id = setInterval(() => setBlock((b) => b + 1), 2400);
    return () => clearInterval(id);
  }, []);

  // hero counter animation
  useEffect(() => {
    function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }
    const els = document.querySelectorAll<HTMLElement>("[data-counter]");
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
  }, []);

  // scroll-driven reveals: benchmark, chart, titles, loop, novel grid
  useEffect(() => {
    // benchmark line
    const BENCH_PCT = (7.47 / 11) * 100;
    document.querySelectorAll<HTMLElement>(".bench").forEach((b) => {
      b.style.left = BENCH_PCT + "%";
    });

    // chart bars reveal
    const chart = document.getElementById("gen-chart");
    if (chart) {
      const obs = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              chart.querySelectorAll<HTMLElement>(".bar").forEach((bar, i) => {
                const w = (parseFloat(bar.dataset.yield!) / 11) * 100;
                setTimeout(() => { bar.style.width = w + "%"; }, i * 150);
              });
              setTimeout(() => chart.classList.add("bars-revealed"), 1000);
              obs.unobserve(chart);
            }
          });
        },
        { threshold: 0.3 }
      );
      obs.observe(chart);
    }

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
              <span className="v">{block.toLocaleString()}</span>
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
              <div className="val" data-counter="3" data-format="int">0</div>
              <div className="sub">seeded 14d 06h ago</div>
            </div>
            <div className="hstat" data-tone="red">
              <div className="lab">Agents Recalled</div>
              <div className="val" data-counter="7" data-format="int">0</div>
              <div className="sub">21 constraints inherited</div>
            </div>
            <div className="hstat" data-tone="green">
              <div className="lab">Avg Yield · Gen 2</div>
              <div className="val" data-counter="8.61" data-format="pct">0.00%</div>
              <div className="sub">vs 7.47% benchmark</div>
            </div>
            <div className="hstat" data-tone="green">
              <div className="lab">Improvement</div>
              <div className="val" data-counter="2.30" data-format="signed">+0.00%</div>
              <div className="sub">Gen 2 over Gen 0</div>
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
                <div className="gen-row">
                  <div className="gen-label">GEN 0<span className="sub">3 spawned</span></div>
                  <div className="track">
                    <div className="bench"><span className="lbl">BENCHMARK · 7.47%</span></div>
                    <div className="bar" data-tone="red" data-yield="6.31"><span className="bar-end">6.31%</span></div>
                  </div>
                  <div className="gen-tail"><span className="pill" data-tone="terminated"><span className="dot" />2 Terminated</span></div>
                </div>
                <div className="gen-row">
                  <div className="gen-label">GEN 1<span className="sub">4 spawned</span></div>
                  <div className="track">
                    <div className="bench" />
                    <div className="bar" data-tone="amber" data-yield="7.12"><span className="bar-end">7.12%</span></div>
                  </div>
                  <div className="gen-tail"><span className="pill" data-tone="terminated"><span className="dot" />3 Terminated</span></div>
                </div>
                <div className="gen-row">
                  <div className="gen-label">GEN 2<span className="sub">5 spawned</span></div>
                  <div className="track">
                    <div className="bench" />
                    <div className="bar" data-tone="green" data-yield="8.61"><span className="bar-end">8.61%</span></div>
                  </div>
                  <div className="gen-tail"><span className="pill" data-tone="active"><span className="dot" />5 Active</span></div>
                </div>
                <div className="callout">
                  <p className="h">Generation 2 outperforms Generation 0 by <span className="pos">+2.30%</span> risk-adjusted yield.</p>
                  <p className="s"><span className="num">7</span> terminations produced <span className="num">21</span> inherited constraints across the lineage.</p>
                </div>
              </div>
            </div>
            <div>
              <h3 className="col-title">Deployed Contracts</h3>
              <div className="contract-stack">
                {[
                  {
                    name: "SpawnFactory",
                    addr: "0x73060181a87703C72dB3b147413c80de40576FB8",
                    href: "https://mantlescan.xyz/address/0x73060181a87703c72db3b147413c80de40576fb8",
                  },
                  {
                    name: "LineageRegistry",
                    addr: "0x0466c58d7955cFdfa9E2070077D2f5E26561b59E",
                    href: "https://mantlescan.xyz/address/0x0466c58d7955cfdfa9e2070077d2f5e26561b59e",
                  },
                  {
                    name: "ChildAgent (impl)",
                    addr: "0x289390469925E953545Ccc96a13D0b5408A835c0",
                    href: "https://mantlescan.xyz/address/0x289390469925e953545ccc96a13d0b5408a835c0",
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
            <a className="chip" href="https://mantlescan.xyz/address/0x73060181a87703c72db3b147413c80de40576fb8" target="_blank" rel="noopener noreferrer">SpawnFactory 0x7306…FB8</a>
            <a className="chip" href="https://mantlescan.xyz/address/0x0466c58d7955cfdfa9e2070077d2f5e26561b59e" target="_blank" rel="noopener noreferrer">LineageRegistry 0x0466…59E</a>
            <a className="chip" href="https://mantlescan.xyz/address/0x289390469925e953545ccc96a13d0b5408a835c0" target="_blank" rel="noopener noreferrer">ChildAgent 0x2893…5c0</a>
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
