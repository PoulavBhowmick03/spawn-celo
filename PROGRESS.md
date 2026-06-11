# PROGRESS.md — Celo Hedge Swarm build log

> **Context for readers:** This is the development journal for porting Spawn Protocol
> to Celo for the Celo Onchain Agents Hackathon (deadline June 15, 2026).
> Phase 0 below is the initial codebase inventory — it documents the *source* codebase
> that was being ported from (prior chain), not the Celo submission itself.
> Phases 1–6 record the actual Celo build.

## Phase 1 — Chain plumbing (2026-06-10)

- **Done**: `agent/src/chains/celo/` — `addresses.ts` (every address triple-verified: authoritative source + docs cross-check + live forno read; source URLs inline), `chain.ts` (viem celo clients, RPC fallback, CIP-64-preserving types), `wallets.ts` (mnemonic+HD, index 0 = orchestrator, N = agent N), `budget.ts` ($50/$5/$5 caps + kill switch, code-enforced), `activity-log.ts` (JSONL with rationales), `smoke-feecurrency.ts` (dry-run by default, `ALLOW_LIVE_SMOKE=true` to broadcast). `.env.example` Celo section added. `npm run smoke:celo`.
- **Verified by**: `tsc --noEmit` clean; dry-run with public test mnemonic derives canonical addresses and reads live Celo state via forno (chain id 42220 asserted).
- **Key findings**: Mento stables rebranded onchain (cUSD→USDm, cEUR→EURm, cREAL→BRLm; same addresses). ERC-8004 mainnet registries on Celo: Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`, Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (the `0x8004A818…`/`0x8004B663…` from the Mantle .env are TESTNET — zero bytecode on Celo mainnet). ValidationRegistry NOT deployed on Celo mainnet → §3.4 validation stretch is moot. USDm/EURm/BRLm are direct fee currencies; USDC/USDT only via adapters.
- **Next**: ~~blocked on funding~~ → completed below.

## Phase 1 complete + treasury live (2026-06-10, Day 1 milestone HIT)

- **Done**: Developer funded orchestrator (HD index 0 = `0xC0296012…50e0`) with 52.89 USDT. Treasury conversion executed live via the new Mento adapter (`mento.ts`, SDK-routed, slippage-capped, budget-railed): one exact-amount approval + 10 × $5 USDT→cUSD tranches (per-tx cap respected) + $1 seed to agent-1 — gas for every tx paid in stablecoins (swaps in USDT via fee adapter, transfers in cUSD; ~$0.05 total gas). Smoke test passed: agent-1 (`0xe689D26D…c945`) sent $0.01 cUSD → orchestrator with CIP-64 `feeCurrency=USDm`, tx `0x3e4ef154…4963`, gasUsed 80475, CELO balance 0 before and after.
- **Verified by**: Celoscan receipts (all status success), onchain balance reads (treasury 48.95 cUSD + 2.84 USDT buffer, agent-1 1 cUSD, 0 CELO everywhere), `celo_activity.jsonl` rationale per tx.
- **Next**: Phase 2 remainder — Aave v3 Celo adapter + fork tests + $2 supply/withdraw smoke (Mento adapter already proven live); then Phase 3 ERC-8004 registration.

## Phase 2 — Protocol adapters + unwind guarantee (2026-06-10)

- **Done**: `aave.ts` (Celo port: verified addresses, USDC/USDT/USDm, live APY reads that throw rather than fake a 0, approve-max batching, feeCurrency + budget rails + rationale logging). `unwind.ts` — developer-required guarantee that culled agents return everything to the treasury they were funded from: withdraw all Aave positions → swap all stables to cUSD (chunked under the $5/tx cap, gas paid in the token being swept) → transfer cUSD home minus fee-currency-priced gas headroom (<$0.01 dust). `smoke-aave.ts` ready (dry-run verified, APY 2.472%).
- **Verified by**: full-lifecycle anvil fork test (`npm run test:fork:celo`): fund → Aave supply → Mento FX swap → cull-unwind; assertions confirm Aave emptied, USDT swept, cUSD swept, treasury recovered the full seed minus spread. Typecheck clean. Mento adapter additionally proven by 10 live mainnet swaps (Phase 1 treasury conversion).
- **Next**: awaiting developer go for the $2 Aave mainnet supply/withdraw smoke (last Phase 1-2 gated tx), then Phase 3.

### Phase 2 mainnet smoke — PASSED (2026-06-10, developer-approved)

- **Done**: $2 cUSD supplied to Aave v3 Celo (tx `0xe62b969a…942c`), aToken position verified (2.0000000+ aUSDm, interest accruing), withdrawn in full (tx `0xbb378215…8add`), gas in cUSD throughout. Treasury ended at 48.9517 cUSD — up on the day after gas, thanks to interest.
- **Gotcha hit and fixed**: forno's load balancer served stale reads right after writes (§8 warning confirmed in practice). Smoke script now retries position reads with backoff + jitter and is idempotent (skips the supply leg if the position already exists). Swarm code must never trust an immediate post-write read from forno.
- **Phase 2 complete.** Next: Phase 3 — agent cards + ERC-8004 registration (orchestrator + 9 agents) against the canonical Celo registries.

## Phase 4 — SWARM LIVE on Celo mainnet (2026-06-11, Day 3 milestone hit on Day 2)

- **Done**: Spawn contracts deployed to Celo mainnet via CIP-64 cUSD gas (LineageRegistry `0x620C…8e85`, ChildAgent impl `0xd6ac…23d3`, SpawnFactory `0x670C…d85d`). Deterministic strategy engine + recomputable fitness (unit-tested) + reputation writer (verified on fork: giveFeedback → getSummary round trip). Swarm launched live: 9 agents funded $5 each, 9 onchain ChildAgent provenance clones, epoch loop running. **Epoch 1 settled live**: 9 reputation feedbacks posted to the canonical Reputation Registry, `ay-anchor` culled (fitness −36.3, full unwind to treasury + onchain recallChild), replacement `mfx-cautious-g2-i10` spawned from the top lineage with mutated genome — funded from the recycled cull pool, self-registered as **ERC-8004 #9256**, onchain spawnChild (clone `0xF7fA…1EdE`). First supervised epoch at 0.5h cadence; auto-switches to the spec's 4h cadence when epoch 3 begins.
- **Verified by**: full-epoch anvil fork test (`npm run test:fork:epoch`); live Celoscan receipts + celo_activity.jsonl rationales for every tx; settle idempotency exercised in production (crash-resume without duplicate feedback or double cull).
- **Production lessons burned in**: CIP-64's estimation-time fee pre-debit breaks near-full-balance transfers (explicit gas limits everywhere); never pay swap gas in the token being swept; Mento FX pools close outside forex hours (FXMarketClosed) — quotes/actions/unwinds all degrade gracefully; fund spawned wallets BEFORE self-registration; persistent pending-spawn queue + cull-once-per-epoch marker make every settle step crash-resumable.
- **Next**: Phase 5 dashboard re-skin + transparency layer; Phase 6 x402 signal agent.

## Phase 5 — Dashboard + transparency layer LIVE (2026-06-11, Day 4 milestone hit on Day 2)

- **Done**: https://spawn-celo-swarm.vercel.app — reads the same public artifacts the orchestrator pushes to GitHub each epoch (state, activity log, epoch reports); no private API, survives swarm-host downtime. Swarm table with per-agent 8004scan/Celoscan links, epoch-by-epoch evolution view (culls/spawns/scores + reputation tx links), full activity-log viewer with rationales, recompute-it-yourself section with the fitness formula and all contract links. README live-links + 8004scan identity table filled. Agent cards got a logo (8004scan listing polish).
- **Hardening shipped alongside**: residual sweeper recovers value stranded in retired wallets (sweep gas falls back to the swept token when cUSD is dust); spawn funding draws on the live treasury. Result observed in production: ay-anchor's $4.49 + hc-light's $4.94 recovered, queued spawn completed — **mfx-cautious-g2-i11, ERC-8004 #9257** (second evolved agent). Swarm steady-state: 10 active / 2 retired, 4h epochs.
- **Next**: Phase 6 — x402 signal agent + paying swarm agents.

## Phase 6 — x402 agent-to-agent economy LIVE (2026-06-11)

- **Done**: Self-hosted x402 (standard wire protocol — HTTP 402, base64 X-PAYMENT, exact scheme; settlement = EIP-3009 transferWithAuthorization on Celo-native USDC, no external facilitator since THIRDWEB_SECRET_KEY absent; swappable later). Signal oracle (HD 30, **ERC-8004 #9258**, x402Support card) sells 5-min-resolution Mento FX momentum + live Aave APYs at $0.002/call; samples quotes every 5 min. useSignal agents (mfx-aggressive, ay-chaser, hc-mid + descendants) buy a signal before each epoch evaluation — purchased momentum replaces their epoch-boundary estimate. Phase 6 funded from the undeployed USDT buffer (~$1.8), agent trading capital untouched. **First mainnet sale verified end-to-end**: settlement tx `0x7a5135df…50cb`.
- **Also shipped (pre-audit items)**: `report:epoch` judge report (§9), viewer-local dashboard timestamps, mid-epoch hourly ticks (act only when thresholds fire — honest intra-epoch activity), `caffeinate` host-sleep guard.
- **Next**: supervised kill-switch test at the next epoch boundary (§9), demo video, submission checklist (user items: Self ID, quote-tweet, Telegram).

## Kill switch tested + production hardening (2026-06-11, §9 complete)

- **Kill-switch supervised cycle PASSED on mainnet**: SIGINT during epoch 4 → all 9 active agents unwound to the treasury ($43.76 cUSD recovered; hc-mid's deferred legs picked up by the residual sweeper) → relaunch re-funded every agent to $5 and the swarm resumed the same epoch. The §9 "one supervised unwind-and-restart cycle" requirement is done.
- **In production since**: epoch 4 settled autonomously (culled + spawned ay-balanced-g2-i13 — fourth evolved agent), epoch 5 running. x402 purchases at epoch start: mfx-aggressive, ay-chaser, hc-mid each bought signals with onchain USDC settlements; spawned useSignal agents now receive a USDC budget at spawn time.
- **Hardening**: swarm runs under a supervisor (relaunches on crash — e.g. forno receipt-poll timeouts on mined txs; stops on clean kill-switch exit); fixed the flat post-settle sleep that suppressed hourly mid-epoch ticks; caffeinate guards against host sleep.
- **Remaining (user)**: Self Agent ID, quote-tweet, Telegram, demo video (Day 5). Optional: Fly.io migration if the Mac can't stay on until June 15.

## Phase 3 — ERC-8004 identities live (2026-06-10, Day 2 milestone hit on Day 1)

- **Done**: repo pushed to github.com/PoulavBhowmick03/spawn-celo (Pages enabled, main:/docs). 10 agent cards (eip-8004 registration-v1) at poulavbhowmick03.github.io/spawn-celo/agents/. All 10 identities minted in the canonical Celo Identity Registry, self-owned by each agent wallet (required so the orchestrator can post reputation feedback — registry forbids owner self-feedback): orchestrator #9240, mfx-cautious #9241, mfx-balanced #9242, mfx-aggressive #9243, ay-anchor #9244, ay-balanced #9245, ay-chaser #9246, hc-light #9247, hc-mid #9248, hc-heavy #9249. Cards regenerated with registrations[] and republished; registry mapping in docs/agents/registry.json.
- **Verified by**: onchain ownerOf+tokenURI per identity (with lag-resistant retries); 8004scan.io/agents/celo/9240 renders "Spawn Hedge Swarm Orchestrator" (indexer resolved our card); every registration + gas seed logged with rationale in celo_activity.jsonl.
- **Next**: Phase 4 — deterministic strategies, recomputable fitness engine, 4h epoch loop with bottom-20% cull → unwind-to-treasury, reputation writer (giveFeedback from the orchestrator identity), kill switch, fund 9 agents $5 each, run first supervised epoch.

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
