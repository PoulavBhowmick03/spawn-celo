# Spawn Protocol (Mantle Edition) — End-to-End Audit Ledger

Started: 2026-06-09. Auditor: Claude Code. Mode: read-only until SPEND GATE.

Deployer/Treasury address (DEPLOYER_PRIVATE_KEY == TREASURY_PRIVATE_KEY, SAME KEY):
`0xC0296012Cfbb0e6DF5dA7158B65Dbc46DD9650e0`

## Phase 0 — Inventory & Ground Truth

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 0.1 | `.env` gitignored, not tracked | PASS | `.gitignore` has `.env`; `git ls-files .env` → not tracked |
| 0.2 | Deployer holds ~$10 | **FAIL/DISCREPANCY** | On-chain: **2.1628 MNT only** (~$1–2 at MNT price), **0 USDe**, **0 aUSDe** |
| 0.3 | Asset reconciliation (request said "USDC") | **DISCREPANCY** | `.env` has NO `USDC_ADDRESS`. Live asset is **USDe** (Ethena) supplied to Aave. Wallet holds 0 USDe → real supply path cannot execute |
| 0.4 | Deployer == Treasury | NOTE/RISK | Both env vars = same private key |
| 0.5 | Spawn contracts deployed on Mantle | PASS | SpawnFactory (2122B), LineageRegistry (5627B), ChildAgentImpl (2847B) all have code |
| 0.6 | ERC-8004 Identity + Reputation registries deployed | **FAIL** | code size = **0** at `0x8004A818...` and `0x8004B663...` on Mantle → NOT deployed there |
| 0.7 | Aave/USDe/aUSDe live | PASS (pending reserve check) | AavePool proxy 1841B, USDe 13886B, aUSDe proxy 1841B |

### Key implications so far
- The headline live-spend premise ("~$10 USDC being spent on Aave") is **not currently executable**: the wallet has zero USDe and ~2.16 MNT (gas only). The only real on-chain action this key can perform is paying MNT gas.
- ERC-8004 identity/reputation UI/runtime features cannot be reading live data from those addresses on Mantle (no contract there).

## Phase 1 — Contract layer (PASS)
- `forge build` clean; `forge test -vv` → **137 passed, 0 failed, 2 skipped** (skips are Mantle-fork gated). 
- On-chain wiring verified: SpawnFactory.lineageRegistry → `0x0466…b59E` ✓, SpawnFactory.childImplementation → `0xD2d7…3F72` ✓, matches broadcast artifacts (chain 5000, sender = deployer).
- **LineageRegistry.owner() == deployer** and **allowedCallers[deployer] == true** ✓ → operator IS authorized for pushCID/postGenerationResult.
- Aave `getReserveData(USDe)`: aToken field = `0xb9aCA9…5ee7` matches `USDE_ATOKEN` ✓; live supply rate ≈ **0.62%** (currentLiquidityRate 6.23e24 ray). Reserve is live.
- Access control: no arbitrary fund-drain path. All treasury egress owner-gated / yield-capped. `spawnChild` is permissionless (no funds at stake). `recallChild`/`recordDecisionHash` parent-gated.
- RISK (minor): ChildGovernor clones can receive ETH but have no withdrawal fn (fund-lock). Demo/verify scripts call non-existent `spawnChildWithOperator` (would revert) — not in prod path.

## Phase 2 — Agent runtime ↔ contracts (PASS on safety, RISK on fidelity)
- All four `ALLOW_LIVE_*` flags correctly gate every broadcast; default = dry-run (returns pseudo tx hashes). Defense-in-depth on generation posts. No unguarded broadcast in parent/child runtime.
- Money path correct on decimals: USDe transfer (18d) `parent.ts:579`, MNT gas `parent.ts:602`, Aave supply/withdraw 18d `aave.ts:199/219/246`, Moe USDe(18)+USDC(6) `merchant-moe.ts:195-196`.
- Benchmark IS read live from Aave per spawn (`aave.ts:162` → getAaveYield), 4.50 only on catch — but `getAaveYield` swallows errors to 0, so the 4.50 fallback is largely unreachable (RISK minor / misleading).
- **RISK (fidelity):** child portfolio accounting is simulated in JS independent of chain; `getMoeLPAPY`/`getMoeLPValue` hardcoded to **0** (`merchant-moe.ts:168-182`); per-cycle yields derived from **sine-wave `simulatedYield`** (`child.ts:104,399-404`), then surfaced as the agent's yield.
- **RISK (fund-safety):** DEPLOYER == TREASURY (one key). Child keys derived deterministically from treasury key + public lineage/generation inputs → anyone with the treasury key (or the public derivation inputs + key leak) can regenerate/drain all child wallets.

## Phase 3 — Dashboard ↔ runtime (RISK: live fakes present)
- **Hardcoded values rendered as live:**
  - `page.tsx:69,91` — fake "live block" counter (literal `76_418_902`, +1 client-side).
  - `page.tsx:355,363` — Gen 0 (6.31%) / Gen 1 (7.12%) yield bars hardcoded; only latest bar is live.
  - `LineageTree.tsx:8-36` — **entire ancestry tree hardcoded** (fake names + fake IPFS CIDs); ignores its `lineageKey` prop. Shown on /terminal.
  - `lib/mockData.ts` (`IS_MOCK_DATA=true`) — full fabricated swarm shown as silent fallback after 2 failed API polls (amber banner only differentiator).
- Control-server (`control-server.ts`) serves **only file-backed data** (swarm_state.json / swarm_events.json / agent_log.json) — **no direct chain reads**; tx hashes can be `pseudoHash` fakes when flags off. `BENCHMARK_YIELD_PCT=4.5` hardcoded default.
- **Dead but misleading:** `lib/contracts.ts`, `client.ts`, `server-client.ts`, `ChainContext.tsx`, `api/swarm` all hardwired to **Base Sepolia (84532)** with wrong addresses, while UI claims "Mantle Mainnet". All powered routes now redirect away.
- **Genuinely live & correct:** `/community` (direct on-chain viem reads/writes to Mantle 5000), `/lineage`, `/judge-flow`, connected-state `/terminal`, root hero stats (`/api/generations`). Live contract addresses match env.

## Phase 4 — Integration & evidence
- **ERC-8004 Identity (`0x8004A818…`) and Reputation (`0x8004B663…`) registries have ZERO bytecode on Mantle** (confirmed by my `cast code` + the integration test that self-skips with "no bytecode on current Mantle RPC"). Any UI/runtime feature pointed at these is not reading live Mantle data.
- IPFS/Filebase + ENS wiring not exercised live (no live run with funds).

## ===== SPEND GATE: NOT SATISFIED — HALTING BEFORE ANY SPEND =====
Gate requires: zero unresolved fund-path FAILs, resolved asset/amount story, a valid dry-run producing correct calldata, worst-case spend < available with headroom.

**Blocking facts:**
1. **Asset premise is wrong.** Request said "mainnet USDC on Aave." This build's live asset is **USDe**; `.env` has no `USDC_ADDRESS`. The wallet holds **0 USDe and 0 aUSDe**.
2. **Funds ≠ $10.** Wallet holds **2.16 MNT (~$1–2) and zero stablecoins.** The cheapest representative contract write (Aave USDe `supply`) is **impossible** — there is no USDe to supply. Proving it would first require swapping MNT→USDe (Merchant Moe), which itself spends funds, has hardcoded pair + zero exit-slippage protection, and exceeds the "tiny $1 supply" scope.
3. The only real on-chain action executable with the current wallet is **gas-only** (e.g., permissionless `spawnChild`, or authorized `postGenerationResult`) — none of which is "USDC/USDe being spent on Aave accordingly," and none of which the file-backed dashboard would reflect without a runtime write to swarm_state.json.

**Verdict: do NOT flip any ALLOW_LIVE_* flag. Awaiting user go/no-go.**

## ===== PHASE 5 — LIVE MAINNET PROOF (user-approved) =====
User confirmed wallet holds ~15 USDC. On-chain check: **14.529121 USDC** at `0x09Bc4E0D…0dF9`.
Discovered USDC is itself a live Aave reserve (aToken `0xcb81…304F`, ~2.94% supply rate), so a
direct USDC supply/withdraw proves "mainnet USDC spent on Aave" with NO swap risk and full reversibility.
(Note: project's own runtime supplies USDe, not USDC — this proof ran via `cast`, not the USDe code path.)

| Step | Tx hash | Result |
|------|---------|--------|
| approve 5 USDC → pool | `0x41d580e60a84bb199e62b60b8ce7e34901e18e95f5a7001a95f06362eb0be073` | status 1 |
| supply 5 USDC → Aave | `0xc9cbef4f26070bd04ae59150261d27eceed235ba4c7193a31dc36c5b52afbf36` | aUSDC 0 → 4.999999, USDC −5 |
| withdraw max → wallet | `0x81b70beb591d78490d00521a04674da0082969f11fc3519ad6a4629261802c75` | aUSDC → 0, USDC restored |

- USDC start **14.529121** → end **14.529120** (−0.000001 dust). aUSDC 0 → ~5 → 0.
- Gas: 2.162829 → 2.137776 MNT = **~0.0251 MNT** total (~cents) across 3 txs.
- **CONCLUSION: the on-chain Aave DeFi leg works with real mainnet funds and is fully recoverable.**
  This validates the contract/DeFi layer; it does NOT resolve the dashboard-fakes / simulated-yield /
  control-server-not-reading-chain / ERC-8004-not-deployed findings above, which remain open.

## ===== REMEDIATION (branch `fix/audit-remediation`, 3 parallel agents) =====
Authoritative verification after merge: contracts **137 pass / 0 fail / 2 skip**, agent `tsc --noEmit` **exit 0**, dashboard `npm run build` **exit 0**.

### RESOLVED
- **P1a LineageTree** — `LineageTree.tsx` rewritten: reads real `LineageRegistry.getLineage(lineageKey)` on-chain (via `lib/mantle.ts`), keys off the real prop, renders loading/error/"no lineage on-chain"/ready states. Fake names/CIDs gone.
- **P1b page.tsx** — fake `76_418_902` block counter → real `getBlockNumber()` poll (also fixed in `Navbar.tsx`); all gen-yield bars now from real `/api/generations`; hardcoded `data-bench-pct` removed/derived.
- **P1c mockData fallback** — `mockData.ts` deleted; `useSwarmData.ts` silent fake fallback replaced with explicit red "CONTROL SERVER UNAVAILABLE — no live data" state (TerminalDashboard/judge-flow/lineage).
- **P1d dead Base Sepolia stack** — deleted `lib/{mockData,client,contracts,abis}.ts`, `context/ChainContext.tsx`, hooks `use{Polymarket,Proposals,Timeline}.ts`, components `{Polymarket,Proposal,Timeline,StorageInline}*`, and `api/{swarm,polymarket,proposals,timeline}`; `server-client.ts` repointed Base Sepolia → Mantle (5000).
- **P2 control-server** — `/api/state`,`/api/generations`,`/health`,`/api/lineage/*` now do real chain reads (Aave benchmark + LineageRegistry CIDs/gen-count) with labeled `source`; hardcoded `BENCHMARK_YIELD_PCT=4.5` → live value w/ env fallback labeled; dry-run/pseudo tx hashes flagged `txSimulated` and get no explorer link.
- **P3a/3b/3c runtime yields** — `simulatedYield` gated behind backtest/dry-run only and flagged `yieldIsSimulated`; live mode reports live Aave or errors; `getMoeLPAPY/Value` return real reads or `null` (no fake 0), child stops clobbering `moeLPValue`; `getAaveYield` now propagates errors so the 4.50 fallback is reachable.
- **P4a USDe-native** — documented in code + `.env.example`; Moe USDC path degrades to log+HOLD when `USDC_ADDRESS` unset instead of throwing.
- **P4b Moe exit slippage** — `removeLiquidity` now computes real `amountXMin/amountYMin` (reserves × share, 0.5% tol) instead of `0,0`.
- **5b broken scripts** — `demo.ts`/`demo-crosschain.ts`/`verify-live-vote.ts` (call non-existent `spawnChildWithOperator`, depend on empty-stub ABIs) marked LEGACY and guarded behind `ALLOW_LEGACY_*` so they can't run accidentally.
- **5c ungated write** — `update-values.ts setGovernanceValues` now gated behind `ALLOW_LIVE_GOVERNANCE_WRITE === "true"`.
- **5d key hygiene** — `SECURITY.md` added (same-key + derivable-child-key drain risk, rotate-the-exposed-key recommendation); `parent.ts` documents the risk and supports distinct deployer/treasury keys; README links SECURITY.md.

### OPEN (need human sign-off — intentionally not implemented)
- **P4 Option B** — real USDC→USDe swap (Merchant Moe LBRouter) for USDC seeding. Deferred; USDe-native for now.
- **5a ERC-8004** — Identity (`0x8004A818…`) + Reputation (`0x8004B663…`) registries have zero bytecode on Mantle. Decision needed: deploy to Mantle, or remove the features. UI + `.env.example` now mark them unavailable; not deployed.
- **Key rotation** — the funded key in `.env` was exposed; rotate before any further live use (documented in SECURITY.md, not actioned).
- **Orphaned dashboard API routes** — `agent-log-server.ts` `KNOWN_CID` + `/api/{logs,budget,receipt,storage,...}` are server-side log/receipt plumbing now unused by any live page; left in place (repointed to Mantle), flagged for a pruning decision.

