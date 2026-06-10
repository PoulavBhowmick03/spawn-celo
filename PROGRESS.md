# PROGRESS.md — Celo Hedge Swarm build log

## Phase 1 — Chain plumbing (2026-06-10)

- **Done**: `agent/src/chains/celo/` — `addresses.ts` (every address triple-verified: authoritative source + docs cross-check + live forno read; source URLs inline), `chain.ts` (viem celo clients, RPC fallback, CIP-64-preserving types), `wallets.ts` (mnemonic+HD, index 0 = orchestrator, N = agent N), `budget.ts` ($50/$5/$5 caps + kill switch, code-enforced), `activity-log.ts` (JSONL with rationales), `smoke-feecurrency.ts` (dry-run by default, `ALLOW_LIVE_SMOKE=true` to broadcast). `.env.example` Celo section added. `npm run smoke:celo`.
- **Verified by**: `tsc --noEmit` clean; dry-run with public test mnemonic derives canonical addresses and reads live Celo state via forno (chain id 42220 asserted).
- **Key findings**: Mento stables rebranded onchain (cUSD→USDm, cEUR→EURm, cREAL→BRLm; same addresses). ERC-8004 mainnet registries on Celo: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (the `0x8004A818…`/`0x8004B663…` from the Mantle .env are TESTNET — zero bytecode on Celo mainnet). ValidationRegistry NOT deployed on Celo mainnet → §3.4 validation stretch is moot. USDm/EURm/BRLm are direct fee currencies; USDC/USDT only via adapters.
- **Next**: ~~blocked on funding~~ → completed below.

## Phase 1 complete + treasury live (2026-06-10, Day 1 milestone HIT)

- **Done**: Developer funded orchestrator (HD index 0 = `0xC0296012…50e0`) with 52.89 USDT. Treasury conversion executed live via the new Mento adapter (`mento.ts`, SDK-routed, slippage-capped, budget-railed): one exact-amount approval + 10 × $5 USDT→cUSD tranches (per-tx cap respected) + $1 seed to agent-1 — gas for every tx paid in stablecoins (swaps in USDT via fee adapter, transfers in cUSD; ~$0.05 total gas). Smoke test passed: agent-1 (`0xe689D26D…c945`) sent $0.01 cUSD → orchestrator with CIP-64 `feeCurrency=USDm`, tx `0x3e4ef154…4963`, gasUsed 80475, CELO balance 0 before and after.
- **Verified by**: Celoscan receipts (all status success), onchain balance reads (treasury 48.95 cUSD + 2.84 USDT buffer, agent-1 1 cUSD, 0 CELO everywhere), `celo_activity.jsonl` rationale per tx.
- **Next**: Phase 2 remainder — Aave v3 Celo adapter + fork tests + $2 supply/withdraw smoke (Mento adapter already proven live); then Phase 3 ERC-8004 registration.

## Phase 0 — Inventory of the existing Spawn codebase (2026-06-10)

Status: **map complete, awaiting developer confirmation before any code is written.**
Verified by: full read of `agent/src/`, `contracts/`, `dashboard/src/`, `.env.example`, `run.sh`, git history.

### 0.1 Repo layout

```
agent/        TypeScript runtime (viem + tsx, no framework)
  src/parent.ts          orchestrator: spawns children, evaluation loop, cull/respawn (~960 lines)
  src/child.ts           per-agent decision loop (forked process, IPC to parent)
  src/control-server.ts  HTTP server :8787 — the API the dashboard polls
  src/chain.ts           Mantle chain object + public client (HARDCODED chain id 5000)
  src/wallet-manager.ts  child wallet derivation (keccak256, not mnemonic/HD)
  src/aave.ts            Aave v3 supply/withdraw/yield adapter
  src/merchant-moe.ts    Mantle-only Moe LP adapter (drop for Celo)
  src/identity.ts        ERC-8004 register/metadata/reputation/validation helpers (961 lines)
  src/logger.ts          structured activity log → agent_log.json (+ IPFS/Filecoin pinning)
  src/venice.ts          Venice AI reasoning (decisions + post-mortems)
  src/lineage.ts         LineageRegistry pushCID/read
  src/backtest.ts        offline backtest harness
contracts/    Foundry project (solc 0.8.28, OpenZeppelin Clones)
dashboard/    Next.js 16 App Router, polls control-server + reads chain directly
swarm_state.json / swarm_events.json / agent_log.json   runtime artifacts at repo root
```

### 0.2 Git topology — CORRECTION NEEDED to CLAUDE.md §5

- The Mantle codebase (the thing we are porting) lives on **`fix/audit-remediation`** (HEAD `2baf895`, includes all audit fixes).
- **`main` is NOT an ancestor** — it holds the old Solana/SwarmOS history ("Colosseum SwarmOS"). Branching `celo-hackathon` from `main` would discard the entire Mantle codebase.
- → **Proposal: branch `celo-hackathon` from `fix/audit-remediation`.** Needs developer confirmation.
- Working tree has uncommitted Mantle-deploy work in flight: modified `agent/tsconfig.json`, `swarm_events.json`, `swarm_state.json`, deleted `AGENTS.md`; untracked `Dockerfile`, `.dockerignore`, `fly.toml`, `agent/src/elfa.ts` (Elfa AI social-sentiment feed for decision prompts). This repo is ALSO the live Mantle submission (same deadline) — must not clobber these.

### 0.3 Chain configuration — where it lives

| What | Where | Celo impact |
|---|---|---|
| Chain object + RPC | `agent/src/chain.ts` (Mantle id 5000 hardcoded) | Replace with viem `celo` chain (gives CIP-64 formatters). No per-chain directory exists — `src/chains/celo/` from CLAUDE.md §5 must be created fresh, or `chain.ts` generalized. |
| All protocol/contract addresses | `.env` only (no addresses.ts) | New `agent/src/chains/celo/addresses.ts` with source-URL comments, per Phase 1 spec. |
| Dashboard chain | `dashboard/src/lib/mantle.ts` + `src/lib/server-client.ts` | Both hardcode Mantle; swap to Celo + celoscan. |
| Leftovers | `wallet-manager.ts` has a Celo Sepolia fallback def; `run.sh` exports CELO_SEPOLIA/BASE_SEPOLIA vars; `contracts/broadcast/` has Celo Sepolia (11142220) deploy runs from a past hackathon | Evidence prior Celo testnet deploys worked; reusable reference, not current. |

### 0.4 How the Mantle deploy was done

- Script: `contracts/script/Deploy.s.sol`. Pre-deploy `LineageRegistry`, export `LINEAGE_REGISTRY_ADDRESS`, then deploy `ChildAgent` implementation + `SpawnFactory` (clones pattern).
- Mantle (5000) artifacts in `contracts/broadcast/Deploy.s.sol/5000/run-latest.json`:
  - ChildAgent impl `0xD2d79F4A19E0D77267aBe80d85c33630d0923F72`
  - SpawnFactory `0x94171e5D54792149E14fFa19197e3c17E263C740`
  - LineageRegistry `0x0466c58d7955cFdfa9E2070077D2f5E26561b59E` (pre-deployed)
- **Gotcha found:** `SpawnFactory.sol:13` hardcodes `ERC8004_REGISTRY = 0x8004A818...BD9e` as a `constant` (zero bytecode on Mantle, graceful fallback `agentId = 0`). For Celo we must verify the canonical Celo ERC-8004 address per CLAUDE.md §4 and either update the constant or (better) parameterize it in the constructor before redeploy.
- Contracts are otherwise chain-agnostic (no chain ids, all addresses constructor/env params). Repo also contains its OWN `ReputationRegistry.sol`/`ValidationRegistry.sol` — **these must NOT be used for track 3**; 8004scan only indexes canonical deployments. Use them for nothing, or only as local test doubles.

### 0.5 Strategy / agent abstractions — what exists vs what CLAUDE.md specifies

**No `Strategy` interface exists.** The existing model:
- `STRATEGY_PROFILES` array in `parent.ts:95-161` — 5 parameter bundles (`targetAaveUSDeBps`, `maxTradeBps`, `minimumSpreadBps`, `riskScoreModifier`, …) each with a Venice AI system prompt.
- Each child (forked process, `child.ts`) loops every 30s: read Aave yield → **Venice LLM decides** the action (SUPPLY/WITHDRAW/HOLD) → execute → report to parent via IPC with rationale.
- Parent evaluation loop (`parent.ts:937-956`) every 75s: fitness = `(excessYield/|drawdown|) + activityScore − volatilityPenalty + profileModifier`; **cull trigger = 2 consecutive cycles below `RISK_THRESHOLD`** (not bottom-20%-per-epoch); respawn = sweep funds → Venice post-mortem → IPFS pin → `recallChild()` + `pushCID()` onchain → spawn generation+1 with inherited profile.
- Wallets: children derived via `keccak256(treasuryKey, lineageKey, generation)` from a single `TREASURY_PRIVATE_KEY` — **not mnemonic/HD as CLAUDE.md §3.1 specifies**.

**Deltas requiring a decision (see 0.9):** deterministic `Strategy.evaluate()` vs LLM-driven decisions; 4h epochs + bottom-20% cull vs continuous threshold cull; mnemonic/HD vs keccak derivation; fitness formula replacement (README formula must be the recomputable one).

### 0.6 Protocol adapters — reuse map

| Adapter | File | Celo verdict |
|---|---|---|
| Aave v3 supply/withdraw/getYield | `agent/src/aave.ts` | **Direct reuse** — same canonical Aave v3 interface; swap addresses to `AaveV3Celo` from `@bgd-labs/aave-address-book`, assets USDC/USDT/cUSD. |
| Merchant Moe LP | `agent/src/merchant-moe.ts` | Mantle-only. Drop. |
| DEX/FX swaps | **none exists** | Mento adapter (`@mento-protocol/mento-sdk`) is **new code** — the core of MentoFXRotator. |
| Fee abstraction (CIP-64) | **none exists** | New code. viem `celo` chain formatters; all agent wallet clients must use it. |

### 0.7 ERC-8004 / reputation / x402 — what exists

- `agent/src/identity.ts`: substantial helpers — `registerAgentOnchain(uri, metadata)`, `updateAgentMetadata`, `getReputationSummary`, `getValidationStatus`. Written for Base-Sepolia-era registries; reusable skeleton but every address must be re-verified against the canonical **Celo** ERC-8004 deployments (the single most important address verification, CLAUDE.md §4).
- **Agent cards: nothing exists.** Hosting (GitHub Pages or `/agents` endpoint on the control server) + card JSON generation is new code. Registration requires resolving card URLs first (gotcha §8).
- **Reputation writer: read helpers exist, no per-epoch performance-feedback writer.** New code on top of `identity.ts`.
- **x402: zero code in repo.** Phase 6 is greenfield (thirdweb `facilitator`/`settlePayment`, network celo) plus a paying-client wrapper for `useSignal: true` agents.

### 0.8 What the dashboard expects

- Polls control-server (`NEXT_PUBLIC_API_URL`, default `:8787`): `GET /api/state` → `{agents: ChildState[], cycleCount, isLive, …}`, `GET /api/events` → `SwarmEvent[]`, `GET /api/generations`. Types in `dashboard/src/types.ts` (`ChildState`, `SwarmEvent` with `rationale`, `txHash`, `decisionHash` — already judge-friendly).
- Direct chain reads: `LineageRegistry.getLineage()` via `lib/mantle.ts` client; explorer links via `explorerTx()/explorerAddress()` helpers (mantlescan).
- Pages: `/` landing, `/terminal` live swarm, `/lineage` generation chart, `/judge-flow` audited event trail, `/community` spawn UI, `/how-it-works`.
- **Celo re-point = ~8 files**: `lib/mantle.ts`, `lib/server-client.ts`, `components/OnChainEvidence.tsx`, `components/Navbar.tsx`, `app/page.tsx` (copy), `app/community/page.tsx` (token + chain), `app/how-it-works/page.tsx` (copy), env. Everything else (hooks, event rendering, IPFS fetch, API routes) is chain-agnostic. Keeping control-server response shapes stable means the dashboard barely changes structurally — add 8004scan links + per-agent Celoscan links.

### 0.9 Decisions — CONFIRMED by developer (2026-06-10)

1. **Branch base**: `celo-hackathon` from `fix/audit-remediation`, committing in-flight Mantle WIP first. ✅
2. **Wallet model**: mnemonic + HD path (`MNEMONIC` env, index = agent number). ✅
3. **Decision engine**: deterministic `Strategy.evaluate(ctx) → Action[]`, rationales templated from the rule that fired; Venice only for narrative post-mortems. ✅
4. **Epoch semantics**: 4h epochs, bottom-20% cull, per CLAUDE.md §3.3. ✅
5. **Contracts**: parameterize the ERC-8004 registry address in SpawnFactory's constructor before Celo redeploy (proceeding with the recommendation; trivial to revisit).

Original open questions preserved below for the record.

### 0.9-original Decisions needed from developer before Phase 1

1. **Branch base**: `celo-hackathon` from `fix/audit-remediation` (recommended — main lacks the Mantle codebase), from `restore/mantle-turing-complete`, or merge to main first? Also: commit/stash the in-flight uncommitted Mantle deploy files first?
2. **Wallet model**: switch to CLAUDE.md's mnemonic + HD path (`MNEMONIC` env, index = agent number) — recommended for spec compliance and clean per-agent Celoscan history — or keep the existing keccak treasury-key derivation?
3. **Decision engine**: CLAUDE.md §3.2 specifies deterministic `Strategy.evaluate(ctx) → Action[]` with recomputable fitness; existing code is Venice-LLM-per-cycle. Recommended: implement the deterministic Strategy interface for Celo (rationales templated from the rule that fired — fully auditable), keep Venice only for narrative post-mortems. Confirm?
4. **Epoch semantics**: adopt CLAUDE.md 4h epochs + bottom-20% cull (replacing 75s continuous eval + 2-strikes threshold)? Recommended yes — the README fitness formula depends on epoch boundaries.
5. **Contracts**: redeploy SpawnFactory/ChildAgent/LineageRegistry to Celo with the ERC-8004 constant parameterized (one-line contract change + constructor arg), or deploy unchanged and rely on graceful fallback while doing ERC-8004 registration purely from the agent runtime? Recommended: parameterize — judges can then see `spawnChild` link to the canonical registry.

### Phase 0 status (3-line)

- **Done**: full inventory of agent runtime, contracts, dashboard, deploy artifacts, git topology; reuse/gap map written above.
- **Verified by**: direct file reads + git ancestry checks; no code written, no transactions sent.
- **Next**: developer confirms/corrects 0.9, then Phase 1 (Celo chain plumbing, address verification, CIP-64 smoke test — mainnet tx only after explicit go-ahead).
