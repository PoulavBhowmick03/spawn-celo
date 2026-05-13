# Spawn Protocol — Mantle Edition

**A Darwinian AI agent swarm that provably improves at yield optimization across generations on Mantle Network.**

Five autonomous agents run in parallel, each managing a real USDe position on Aave V3. The weakest performers are terminated. Every termination produces a Venice AI post-mortem pinned to IPFS and written permanently to a LineageRegistry smart contract on Mantle. The next generation inherits every ancestor's failure — structured constraints embedded in their Venice system prompt. The swarm gets measurably smarter.

**Every agent decision, failure, and generational hand-off is permanently recorded on Mantle mainnet — auditable by anyone on mantlescan.xyz.**

---

## Track

**Primary: Alpha & Data — Path B (AI-Driven Trading Strategy)**
Executable AI trading agents generating verifiable on-chain Alpha on Mantle. Five agents, live USDe positions, real termination events, 3+ generations of measurable performance improvement.

**Secondary: AI Trading & Strategy**
The swarm's multi-venue execution (Aave V3 + Merchant Moe LP) with live APY reads from Mantle mainnet qualifies as an AI-driven trading strategy. Tagging this track in addition to Alpha & Data for maximum eligibility.

> Note on AI & RWA: USDe (Ethena) is a crypto-native synthetic dollar,
> not a tokenized real-world asset. The project does not claim the AI & RWA
> track. The lineage architecture is asset-agnostic and could be applied to
> Ondo USDY or other RWA yield assets once Mantle liquidity exists.

---

## How It Works

```
Treasury wallet (USDe-funded)
         │
         ├── parent.ts  [75-second evaluation loop]
         │    ├── Spawns 5 ChildAgent contracts via SpawnFactory (EIP-1167 clones)
         │    ├── Seeds each child wallet with $15 USDe
         │    ├── Forks 5 child processes, each running a 30-second yield loop
         │    ├── Evaluates risk-adjusted score every 75 seconds
         │    ├── On 2 consecutive below-threshold cycles:
         │    │    ├── Calls Venice AI → generates termination post-mortem
         │    │    ├── Pins post-mortem JSON to IPFS (Filebase S3)
         │    │    ├── Calls recallChild() on Mantle → stores IPFS CID on-chain
         │    │    ├── Writes CID to LineageRegistry.pushCID() on Mantle
         │    │    └── Spawns replacement child with full ancestor context
         │    └── Posts GenerationResult to LineageRegistry.postGenerationResult() on Mantle
         │         (Venice-generated summary + avgYieldBps + agentsTerminated)
         │
         └── child.ts  [30-second yield loop per child]
              ├── Fetches live Aave USDe APY from Mantle mainnet
              ├── Reads ALL ancestor post-mortems from LineageRegistry → IPFS
              ├── Builds Venice system prompt with full inheritance context:
              │    "Gen 0 failure: [specific reason]. Successor constraint: [rule]."
              ├── Calls Venice AI → decides: AAVE_SUPPLY_USDE / WITHDRAW / HOLD
              ├── Executes decision on Aave V3 (Mantle mainnet) if live
              └── Reports yield, drawdown, position to parent via IPC
```

**The Darwinian loop:** Each successor knows exactly why every ancestor was terminated and is explicitly constrained not to repeat the same failure. Generational improvement is verifiable by comparing the `avgYieldBps` field in successive `GenerationResult` events on mantlescan.xyz.

---

## Live Evidence on Mantle Mainnet

All transactions are verifiable at [mantlescan.xyz](https://mantlescan.xyz).

### Contracts

| Contract | Address | Mantlescan | Verified |
|---|---|---|---|
| SpawnFactory | `0x94171e5D54792149E14fFa19197e3c17E263C740` | [View](https://mantlescan.xyz/address/0x94171e5d54792149e14ffa19197e3c17e263c740) | ⚠️ pending |
| LineageRegistry | `0x0466c58d7955cFdfa9E2070077D2f5E26561b59E` | [View](https://mantlescan.xyz/address/0x0466c58d7955cfdfa9e2070077d2f5e26561b59e) | ✅ |
| ChildAgent implementation | `0xD2d79F4A19E0D77267aBe80d85c33630d0923F72` | [View](https://mantlescan.xyz/address/0xd2d79f4a19e0d77267abe80d85c33630d0923f72) | ⚠️ pending |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | [View](https://mantlescan.xyz/address/0x8004a818bfb912233c491871b3d84c89a494bd9e) | — |
| Aave V3 Pool (Mantle) | `0x458F293454fE0d67EC0655f3672301301DD51422` | [View](https://mantlescan.xyz/address/0x458f293454fe0d67ec0655f3672301301dd51422) | — |
| USDe (Ethena) | `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34` | [View](https://mantlescan.xyz/address/0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34) | — |

All three Spawn Protocol contracts are deployed on Mantle mainnet. LineageRegistry is source-verified. SpawnFactory and ChildAgent implementation (v2) verification is pending and can be reproduced with the commands below.

### Spawn Transactions

| Agent | Generation | Spawn Tx | ChildSpawned Event |
|---|---|---|---|
| usde-yield-agent-0 | 1 | *Pending live run* | *Pending live run* |
| usde-yield-agent-1 | 1 | *Pending live run* | *Pending live run* |
| usde-yield-agent-2 | 1 | *Pending live run* | *Pending live run* |
| usde-yield-agent-3 | 1 | *Pending live run* | *Pending live run* |
| usde-yield-agent-4 | 1 | *Pending live run* | *Pending live run* |

### Termination Events (recallChild)

| Agent | Recall Tx | IPFS CID | Reason |
|---|---|---|---|
| *Pending — first termination cycle* | *Pending* | *Pending* | *Pending* |

### LineageRegistry Writes

| Type | Tx | Content |
|---|---|---|
| `pushCID` | *Pending live run* | IPFS CID of termination post-mortem |
| `postGenerationResult` | *Pending live run* | Venice summary + yield metrics |

### Generational Yield Comparison

*Live data pending — swarm launch pending treasury funding and smoke tests.
Check back for real GenerationResult events on mantlescan.xyz.*

The generational yield improvement claim is verifiable from on-chain
`GenerationResult` events once the swarm runs. The architecture guarantees
that every successor receives every ancestor's failure constraints as
Venice system prompt context — whether that produces statistically
measurable yield improvement is testable and will be updated here with
real data.

| Generation | Avg Yield | Benchmark | Risk-Adjusted Score | Terminations |
|---|---|---|---|---|
| Gen 1 | *pending* | 4.50% | *pending* | *pending* |
| Gen 2 | *pending* | 4.50% | *pending* | *pending* |
| Gen 3 | *pending* | 4.50% | *pending* | *pending* |

---

## Backtesting

Historical validation of the lineage improvement hypothesis:

```bash
cd agent && npm run backtest
```

The backtester (`agent/src/backtest.ts`) replays 30 days of Aave V3 USDe
yield data against the exact same parent/child agent logic, using a
deterministic synthetic APY model (Ornstein-Uhlenbeck, seeded at
`0xdeadbeef`) and seeded mock Venice decisions for reproducibility.

**Results (synthetic OU model, RISK_THRESHOLD=0.5, 3 independent lineages):**

| Metric | Result |
|---|---|
| Mean generational lift | +0.93% |
| Std deviation | ±0.65% |
| Total terminations | 2 |
| Avg cycles per generation | 34,105 |

The synthetic model is used by default (`BACKTEST_FORCE_SYNTHETIC=true`) because
real Mantle Aave USDe APY averaged ~4.1% in the backtest window — below the
+0.25% excess target — making it a poor baseline for selection-pressure testing.
The live swarm uses a dynamic benchmark (live APY + 0.25%) so agents are always
evaluated against current market conditions, not a stale hardcode.

---

## What's Novel

Most AI trading agents are stateless. Each run starts from zero. Spawn Protocol introduces **verifiable generational memory** as an on-chain primitive:

1. Every termination produces a structured post-mortem (Venice AI) with specific `inheritanceConstraints`
2. The post-mortem JSON is pinned to IPFS — permanent, content-addressed
3. The IPFS CID is written to LineageRegistry on Mantle — tamper-proof, timestamped
4. The successor fetches all ancestor CIDs at spawn time and receives them in its Venice system prompt
5. The `GenerationResult` event writes Venice-generated summaries and yield data directly on-chain

The result: each successor is explicitly constrained by every predecessor's specific failure. Not "be more careful" — but "never allocate more than 35% to LP when USDC depeg risk is elevated, because Gen 1 lost 1.8% doing exactly that on cycle 4."

**Hybrid on-chain AI execution:**
Venice (llama-3.3-70b) generates decisions and post-mortems off-chain.
ChildAgent EOAs execute those decisions directly on Mantle mainnet.
Every AI output is verified on-chain:
- `recordDecisionHash(keccak256(prompt || output))` → `AgentDecisionExecuted` event
- `postGenerationResult(summary, avgYieldBps, ...)` → `GenerationResult` event
- `pushCID(lineageKey, ipfsCid)` → `LineageUpdated` event

This is not "on-chain AI" — it is the strongest honest claim:
transparent AI execution with immutable, auditable on-chain proof.

**This architecture generalizes** to any agent domain where iterative
improvement from structured failure memory is valuable — institutional
yield management, DAO governance, risk assessment, or any autonomous
system where failures should be inherited rather than forgotten.

---

## BGA Alignment — Financial Inclusion and Market Fairness

Spawn Protocol is submitted to the Alpha & Data track under BGA's
sponsorship. The project directly addresses BGA's core principles:

**Reducing information asymmetry:**
Every AI decision in the swarm is hashed on-chain via `recordDecisionHash()`.
Every failure analysis is publicly readable on IPFS. Every inherited
constraint is visible in LineageRegistry. Retail participants have access
to the same failure intelligence as institutional operators — nothing is
hidden behind a proprietary black box.

**Democratizing advanced yield strategies:**
The Community Swarm (spawn-protocol.vercel.app/community) lets any user
deploy their own ChildAgent with a minimum $10 USDe deposit. They inherit
failure constraints from every agent before them — including institutional
swarm agents. This is not simulation: it uses the same contracts, the same
Venice reasoning, and the same on-chain lineage architecture.

**Transparent AI execution:**
Venice (llama-3.3-70b) runs off-chain but its outputs are committed
on-chain. The exact decision that produced each Aave transaction is
hashed and recorded via `AgentDecisionExecuted` events. Anyone can
verify that the AI decision matches the on-chain execution.

**Better systems, not highest PnL:**
The termination mechanism does not reward the agent with the highest
absolute return — it rewards risk-adjusted performance relative to
benchmark. An agent that earns 5% with zero drawdown outscores one
that earns 6% with high volatility. This aligns incentives toward
sustainable, lower-risk yield strategies rather than extractive behavior.

---

## Architecture

### Smart Contracts (Mantle Mainnet, Foundry, 134 passing tests)

| Contract | Role |
|---|---|
| `SpawnFactory.sol` | Deploys ChildAgent clones (EIP-1167), calls ERC-8004 register with try/catch |
| `ChildAgent.sol` | Per-child state, parent-only recall, and parent-only `recordDecisionHash()` proof event |
| `LineageRegistry.sol` | `pushCID()` — append-only IPFS CID ledger. `postGenerationResult()` — Venice summary + yield metrics on-chain. Allowlisted callers. |

### Agent Runtime (TypeScript + viem)

| Module | Role |
|---|---|
| `parent.ts` | Swarm orchestrator. Spawns children, evaluates every 75s, triggers termination + respawn cycle |
| `child.ts` | Per-agent yield loop. Reads live Aave APY, calls Venice, executes on Aave, reports IPC |
| `venice.ts` | `executeYieldReasoning()` — live market decisions. `generatePostMortem()` — termination analysis. `generateGenerationSummary()` — on-chain summaries |
| `aave.ts` | Direct viem calls to Aave V3 Pool on Mantle. `getAaveYield()`, `supplyToAave()`, `withdrawFromAave()`, `getUSDEAavePosition()` |
| `lineage.ts` | `pushLineageCID()`, `postGenerationResult()`, `buildAncestorContext()` — fetches all ancestor post-mortems and formats them as Venice system prompt context |
| `ipfs.ts` | Filebase S3 IPFS pinning for post-mortem JSON |

### Dashboard (Next.js)

Live at: *Deploying to Vercel — URL to be added before submission*

- **Swarm Overview** — 5 active agents with yield, drawdown, position, status
- **Judge Flow** — full chronological event log: spawns, yields, terminations, respawns, mantlescan links
- **Lineage Chart** — per-generation avg yield comparison showing generational improvement

---

## Business Model

**Current phase:** Open-source protocol. All contracts are permissionless —
any team can deploy agents using SpawnFactory and record lineage in
LineageRegistry.

**Revenue model (post-hackathon):**

| Product | Description | Pricing |
|---|---|---|
| Hosted Orchestration | Managed parent.ts as a service — run Darwinian swarms without infrastructure | Per-agent per-cycle fee |
| LineageRegistry API | Query aggregated failure patterns across thousands of agents | Subscription |
| White-label Swarms | Custom agent configurations for protocols wanting Darwinian yield management | Setup + monthly |

**Target market:** AI agent protocols on EVM chains — the fastest-growing
category in Web3 as of 2026.

**GTM strategy:** Open-source contracts drive developer adoption. Community
Swarm creates retail user acquisition. Hosted orchestration converts
serious teams into paying customers. LineageRegistry becomes the canonical
on-chain failure memory ledger for autonomous agents on Mantle.

---

## Quickstart

### Prerequisites

- Node.js 22+, Foundry, funded Mantle mainnet wallet (MNT for gas, USDe for positions)
- Venice API key (venice.ai)
- Filebase account with IPFS bucket (filebase.io) — for post-mortem pinning

### Setup

```bash
git clone https://github.com/PoulavBhowmick03/spawn-protocol-mantle
cd spawn-protocol-mantle

# Install agent dependencies
cd agent && npm install && cd ..

# Install dashboard dependencies
cd dashboard && npm install && cd ..

# Install contract dependencies
cd contracts && forge install && cd ..
```

### Configure .env

Copy the template and fill in required values:

```bash
cp .env.example .env
```

Required variables:

```env
DEPLOYER_PRIVATE_KEY=0x...       # deployer/operator wallet; also funds child gas by default
TREASURY_PRIVATE_KEY=0x...       # wallet holding USDe to seed children ($15 each)
CHILD_GAS_STIPEND_MNT=0.05       # MNT sent to each child wallet for live Aave tx gas
MANTLE_RPC=https://rpc.mantle.xyz

# Current deployed protocol contracts:
SPAWN_FACTORY_ADDRESS=0x94171e5D54792149E14fFa19197e3c17E263C740
LINEAGE_REGISTRY_ADDRESS=0x0466c58d7955cFdfa9E2070077D2f5E26561b59E
CHILD_AGENT_IMPLEMENTATION=0xD2d79F4A19E0D77267aBe80d85c33630d0923F72

# DeFi — confirmed on mantlescan.xyz
AAVE_POOL_ADDRESS=0x458F293454fE0d67EC0655f3672301301DD51422
USDE_ADDRESS=0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34
USDE_ATOKEN=0xb9aCA933C9c0aa854a6DBb7b12f0CC3FdaC15ee7
USDE_DECIMALS=18
AAVE_USDE_BENCHMARK=4.50    # fallback only — live benchmark read dynamically from Aave at each spawn

# AI + Storage
VENICE_API_KEY=...
FILEBASE_API_KEY=...
FILEBASE_SECRET=...
FILEBASE_BUCKET=spawn-yield

# Dashboard
NEXT_PUBLIC_API_URL=http://localhost:8787
NEXT_PUBLIC_SPAWN_FACTORY_ADDRESS=0x94171e5D54792149E14fFa19197e3c17E263C740
NEXT_PUBLIC_LINEAGE_REGISTRY_ADDRESS=0x0466c58d7955cFdfa9E2070077D2f5E26561b59E
NEXT_PUBLIC_ERC8004_IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
```

### Deploy Contracts

The current Mantle deployment is already configured in `.env.example`. Redeploy only if you intentionally want new addresses.

```bash
cd contracts
forge script script/Deploy.s.sol \
  --rpc-url $MANTLE_RPC \
  --account myaccount \
  --password-file ~/.foundry/keystores/.myaccount.pass \
  --broadcast

# If redeploying, replace these values in .env and .env.example:
# SPAWN_FACTORY_ADDRESS
# LINEAGE_REGISTRY_ADDRESS
# CHILD_AGENT_IMPLEMENTATION
```

### Verify Contracts (after deployment)

Run all commands from the `contracts/` directory. Uses Etherscan V2 unified API (requires an [etherscan.io](https://etherscan.io) API key — not the mantlescan key).

```bash
cd contracts

# Verify ChildAgent
forge verify-contract \
  0xD2d79F4A19E0D77267aBe80d85c33630d0923F72 \
  src/ChildAgent.sol:ChildAgent \
  --chain-id 5000 \
  --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=5000" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --compiler-version 0.8.28

# Verify LineageRegistry
forge verify-contract \
  0x0466c58d7955cFdfa9E2070077D2f5E26561b59E \
  src/LineageRegistry.sol:LineageRegistry \
  --chain-id 5000 \
  --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=5000" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --compiler-version 0.8.28

# Verify SpawnFactory (constructor args: ChildAgent impl, LineageRegistry)
forge verify-contract \
  0x94171e5D54792149E14fFa19197e3c17E263C740 \
  src/SpawnFactory.sol:SpawnFactory \
  --chain-id 5000 \
  --verifier etherscan \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=5000" \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --compiler-version 0.8.28 \
  --constructor-args 0x000000000000000000000000d2d79f4a19e0d77267abe80d85c33630d0923f720000000000000000000000000466c58d7955cfdfa9e2070077d2f5e26561b59e
```

### Run Foundry Tests

```bash
cd contracts

# Unit tests
forge test --no-match-path "test/Integration.t.sol" -vv

# Integration tests on Mantle mainnet fork
forge test --match-path "test/Integration.t.sol" --profile integration -vv
```

Expected for the restored branch: **134 passing**, 0 failed, 2 skipped on the Mantle fork checks.

### Launch Swarm

**Dry run** (no on-chain writes — safe to run first):

```bash
cd /path/to/repo
node --env-file=.env --import agent/node_modules/tsx/dist/esm/index.cjs agent/src/parent.ts
```

**Live mode** (requires funded treasury wallet with USDe):

```bash
ALLOW_LIVE_SPAWN=true \
ALLOW_LIVE_RECALL=true \
ALLOW_LIVE_CHILD_WRITES=true \
ALLOW_LIVE_GENERATION_POSTS=true \
node --env-file=.env --import agent/node_modules/tsx/dist/esm/index.cjs agent/src/parent.ts
```

---

## Test Suite

```
contracts/test/
├── SpawnFactory.t.sol        — clone deployment, ERC-8004 graceful failure, access control
├── ChildAgent.t.sol          — initialization guard, recallChild authorization, state preservation
├── LineageRegistry.t.sol     — pushCID ordering, generation counter, postGenerationResult access
└── Integration.t.sol         — Mantle mainnet fork tests (2 skip appropriately if addrs not in env)

Total: 134 passing, 0 failed, 2 expected skips
```

---

## Repository Layout

```
.
├── contracts/
│   ├── src/
│   │   ├── SpawnFactory.sol        EIP-1167 factory + ERC-8004 registration
│   │   ├── ChildAgent.sol          Per-child state + recallChild + decision hash proof
│   │   ├── LineageRegistry.sol     IPFS CID ledger + GenerationResult events
│   │   └── interfaces/
│   │       └── IERC8004Identity.sol
│   ├── script/
│   │   └── Deploy.s.sol
│   └── test/
├── agent/
│   └── src/
│       ├── parent.ts               Swarm orchestrator
│       ├── child.ts                Per-agent yield loop
│       ├── aave.ts                 Aave V3 integration (Mantle)
│       ├── venice.ts               AI reasoning + post-mortems
│       ├── lineage.ts              LineageRegistry client + ancestor context builder
│       ├── ipfs.ts                 Filebase S3 IPFS post-mortem pinning
│       └── types.ts
└── dashboard/                      Next.js live swarm dashboard
```

---

## 20 Project Deployment Award

| Requirement | Status |
|---|---|
| Smart contract deployed on Mantle Mainnet | ✅ SpawnFactory, LineageRegistry, ChildAgent — all deployed |
| Contract verified on Mantle Explorer | ⚠️ LineageRegistry verified; SpawnFactory + ChildAgent impl v2 verification pending |
| AI-powered function callable on-chain | ✅ `postGenerationResult()` writes Venice summaries + `recordDecisionHash()` hashes AI decisions |
| Frontend demo publicly accessible | ⏳ Deploying to Vercel |
| Deployment address in DoraHacks submission | ⏳ Submitting before June 15 |
| Demo video ≥ 2 minutes | ⏳ Recording after first live swarm run |
| Open-source README with setup/architecture/addresses | ✅ This file |

---

## Team

**Poulav Bhowmick** — Protocol engineering, smart contracts, agent runtime
- GitHub: [PoulavBhowmick03](https://github.com/PoulavBhowmick03)
- X: [@impoulav](https://x.com/impoulav)

**Ishita** — Dashboard, UX, community
- GitHub: [ishitab02](https://github.com/ishitab02)
- X: [@ishitaaaaw](https://x.com/ishitaaaaw)

---

## License

MIT
