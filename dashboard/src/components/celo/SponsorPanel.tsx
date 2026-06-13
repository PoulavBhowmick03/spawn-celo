"use client";

/**
 * Sponsor-an-agent flow. A visitor connects a wallet and sends cUSD to the
 * swarm treasury; the orchestrator detects the deposit onchain and spawns a
 * new ERC-8004 agent in the sponsor's name at the next epoch (~within the
 * epoch cadence). It is a sponsorship of an autonomous agent, NOT a custodial
 * deposit — clearly disclosed below. No new contract: the deposit is a plain
 * cUSD transfer, verifiable on Celoscan.
 */

import { useEffect, useState } from "react";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  erc20Abi,
  parseUnits,
  formatUnits,
  type Address,
} from "viem";
import { celo } from "viem/chains";
import {
  CELO_CHAIN_ID,
  CUSD_ADDRESS,
  MIN_SPONSOR_USD,
  CONTRACTS,
  RAW_BASE,
  explorerTx,
  explorerAddress,
  scanAgent,
} from "@/lib/celo";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
function getEthereum(): Eip1193 | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eip1193 }).ethereum ?? null;
}

function lineageKeyFor(addr: string): string {
  return `patron-${addr.slice(2, 8).toLowerCase()}`;
}

type Phase = "idle" | "connecting" | "ready" | "depositing" | "watching" | "spawned" | "error";

type SpawnedAgent = { slug: string; erc8004AgentId: string; address: string };

export function SponsorPanel() {
  const [account, setAccount] = useState<Address | null>(null);
  const [cusd, setCusd] = useState<string | null>(null);
  const [amount, setAmount] = useState("2");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [depositTx, setDepositTx] = useState<string | null>(null);
  const [agent, setAgent] = useState<SpawnedAgent | null>(null);

  const pub = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

  async function refreshBalance(addr: Address) {
    try {
      const bal = await pub.readContract({
        address: CUSD_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [addr],
      });
      setCusd(Number(formatUnits(bal, 18)).toFixed(2));
    } catch {
      setCusd(null);
    }
  }

  async function connect() {
    const eth = getEthereum();
    if (!eth) {
      setError("No Ethereum wallet found. Install MetaMask, Valora, or another Celo-compatible wallet.");
      setPhase("error");
      return;
    }
    setError(null);
    setPhase("connecting");
    try {
      const accts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const addr = accts[0] as Address;
      // ensure Celo mainnet
      const chainIdHex = (await eth.request({ method: "eth_chainId" })) as string;
      if (parseInt(chainIdHex, 16) !== CELO_CHAIN_ID) {
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${CELO_CHAIN_ID.toString(16)}` }] });
        } catch {
          setError("Please switch your wallet to Celo mainnet (chain 42220) and try again.");
          setPhase("error");
          return;
        }
      }
      setAccount(addr);
      await refreshBalance(addr);
      setPhase("ready");
    } catch (e) {
      setError((e as Error).message?.slice(0, 140) ?? "connection failed");
      setPhase("error");
    }
  }

  async function sponsor() {
    const eth = getEthereum();
    if (!eth || !account) return;
    const usd = Number(amount);
    if (!Number.isFinite(usd) || usd < MIN_SPONSOR_USD) {
      setError(`Minimum sponsorship is $${MIN_SPONSOR_USD}.`);
      return;
    }
    setError(null);
    setPhase("depositing");
    try {
      const wallet = createWalletClient({ account, chain: celo, transport: custom(eth) });
      const hash = await wallet.writeContract({
        address: CUSD_ADDRESS,
        abi: erc20Abi,
        functionName: "transfer",
        args: [CONTRACTS.TREASURY as Address, parseUnits(usd.toFixed(6), 18)],
      });
      setDepositTx(hash);
      await pub.waitForTransactionReceipt({ hash });
      setPhase("watching");
    } catch (e) {
      setError((e as Error).message?.slice(0, 160) ?? "deposit failed");
      setPhase("error");
    }
  }

  // once depositing is done, poll the published swarm state for the spawned agent
  useEffect(() => {
    if (phase !== "watching" || !account) return;
    const key = lineageKeyFor(account);
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`${RAW_BASE}/celo_swarm_state.json`, { cache: "no-store" });
        if (res.ok) {
          const state = (await res.json()) as {
            agents: { slug: string; erc8004AgentId: string; address: string; lineageKey: string }[];
          };
          const mine = state.agents
            .filter((a) => a.lineageKey === key)
            .sort((a, b) => Number(b.erc8004AgentId) - Number(a.erc8004AgentId))[0];
          if (mine && mine.erc8004AgentId && mine.erc8004AgentId !== "0") {
            setAgent({ slug: mine.slug, erc8004AgentId: mine.erc8004AgentId, address: mine.address });
            setPhase("spawned");
            stop = true;
          }
        }
      } catch {
        /* transient — keep polling */
      }
    };
    void tick();
    const id = setInterval(() => {
      if (!stop) void tick();
    }, 20_000);
    return () => clearInterval(id);
  }, [phase, account]);

  return (
    <div className="sp-section">
      <h2>Sponsor an agent</h2>
      <p className="sp-rationale" style={{ marginBottom: 18 }}>
        Send cUSD to the swarm treasury and the orchestrator spawns a new agent in your name at the
        next epoch — a real ERC-8004 identity with its own wallet, seeded from the current top
        performer&apos;s strategy, competing (and culled) like any other agent. Gas across the swarm
        is paid in stablecoins; your sponsored agent never holds CELO.
      </p>

      <div
        className="sp-disclaimer"
        style={{ border: "1px solid #2A2A3E", borderRadius: 8, padding: "12px 14px", marginBottom: 20, fontSize: 13, color: "#B8C0CE" }}
      >
        <strong style={{ color: "#FCFF52" }}>This is a sponsorship, not an investment.</strong> Your
        cUSD funds an autonomous experiment and is <strong>not withdrawable</strong>. Sponsored
        capital joins the swarm and is tracked separately from the developer&apos;s $50 budget. Each
        agent is capped at $5. Only sponsor what you&apos;re happy to contribute to a live demo.
      </div>

      {phase === "idle" || phase === "connecting" || (phase === "error" && !account) ? (
        <button className="sp-action" onClick={connect} disabled={phase === "connecting"}>
          {phase === "connecting" ? "connecting…" : "connect wallet"}
        </button>
      ) : null}

      {account && phase !== "spawned" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 460 }}>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 13, color: "#8892A4" }}>
            wallet{" "}
            <a href={explorerAddress(account)} target="_blank" rel="noreferrer" style={{ color: "#4D9EFF" }}>
              {account.slice(0, 6)}…{account.slice(-4)}
            </a>
            {cusd !== null && <span> · {cusd} cUSD</span>}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
            <span>sponsor</span>
            <input
              type="number"
              min={MIN_SPONSOR_USD}
              step="0.5"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={phase === "depositing" || phase === "watching"}
              style={{
                width: 90, padding: "6px 8px", background: "#0E0E1A", border: "1px solid #2A2A3E",
                borderRadius: 6, color: "#E8ECF2", fontFamily: '"JetBrains Mono", monospace',
              }}
            />
            <span>cUSD</span>
          </label>
          <button
            className="sp-action"
            onClick={sponsor}
            disabled={phase === "depositing" || phase === "watching"}
          >
            {phase === "depositing"
              ? "confirm in wallet…"
              : phase === "watching"
                ? "deposit confirmed — waiting for spawn…"
                : `sponsor $${amount} agent`}
          </button>
        </div>
      ) : null}

      {depositTx && (
        <p style={{ marginTop: 14, fontSize: 13 }}>
          deposit:{" "}
          <a href={explorerTx(depositTx)} target="_blank" rel="noreferrer" style={{ color: "#4D9EFF" }}>
            {depositTx.slice(0, 14)}… ↗
          </a>
        </p>
      )}

      {phase === "watching" && (
        <p style={{ marginTop: 6, fontSize: 13, color: "#8892A4" }}>
          Your deposit is onchain. The swarm detects sponsorships at each epoch boundary and will
          register your agent shortly — this page updates automatically (you can leave and come
          back; it&apos;s keyed to your wallet address).
        </p>
      )}

      {phase === "spawned" && agent && (
        <div
          style={{ marginTop: 16, border: "1px solid #22D3A1", borderRadius: 8, padding: "14px 16px", maxWidth: 520 }}
        >
          <div style={{ color: "#22D3A1", fontWeight: 600, marginBottom: 6 }}>
            ✓ Your agent is live: {agent.slug}
          </div>
          <div style={{ fontSize: 13, color: "#B8C0CE", marginBottom: 10 }}>
            ERC-8004 identity #{agent.erc8004AgentId}, self-owned by its own wallet, now competing in
            the swarm. Its fitness, reputation, and every trade are public and recomputable.
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
            <a href={scanAgent(agent.erc8004AgentId)} target="_blank" rel="noreferrer" style={{ color: "#4D9EFF" }}>
              8004scan ↗
            </a>
            <a href={explorerAddress(agent.address)} target="_blank" rel="noreferrer" style={{ color: "#4D9EFF" }}>
              wallet ↗
            </a>
          </div>
        </div>
      )}

      {error && (
        <p style={{ marginTop: 14, fontSize: 13, color: "#FF7878" }}>{error}</p>
      )}
    </div>
  );
}
