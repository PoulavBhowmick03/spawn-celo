# CLAUDE.md — Spawn Protocol: Celo Hedge Swarm

This file is the contract between you (Claude Code) and the developer. Read it fully before writing any code. When this file and an ad-hoc instruction conflict, ask. When this file and README.md conflict, this file wins on engineering decisions, README.md wins on product narrative.

## 1. Mission and win conditions

We are porting Spawn Protocol (a Darwinian multi-agent yield swarm, already live on Mantle mainnet) to Celo mainnet for the Celo Onchain Agents Hackathon (deadline June 15, 2026, 9 AM GMT). The reframe for Celo: the swarm's job is protecting stablecoin purchasing power. Agents compete on FX/yield strategies across Mento stablecoins and Aave v3 Celo. Fit agents replicate, unfit agents are culled.

There are three prize tracks and the architecture must serve all three simultaneously:

1. **Best Agent on Celo ($2,500/$1,000/$500).** Judged on ecosystem mission alignment (real-world payments/FX), consistent onchain activity, and real-world utility. Judges manually review and filter sybil attempts.
2. **Most Onchain Transactions ($500).** Every transaction must be a real strategy decision. Volume comes from genuine swarm activity, never from loops that exist only to emit transactions.
3. **Highest 8004scan Rank ($500).** 8004scan scores on a multi-dimension system including reputation feedback, validation records, and x402 payment wallet metrics. We feed it by registering every swarm agent as a distinct ERC-8004 identity and writing performance-based reputation onchain.

Non-negotiable judge-defense requirement: every onchain action must have a logged, human-readable rationale, and every reputation score we write must be mechanically recomputable from public onchain data. If a judge suspects wash activity, our logs and recomputable fitness function are the defense. Build this in from the start, not as an afterthought.

## 2. Hard constraints

- **Timebox: 2 working days of build, max.** The developer has a competing deadline (Mantle, same day). If a phase is slipping, cut scope per the priority order in section 7. Phase 1 through 4 are mandatory, Phase 5 and 6 are stretch.
- **Mainnet budget: $50 USD equivalent total, hard cap.** Per-agent wallet balance cap: $5. Slippage cap on every swap: 1%. If any single transaction would move more than $5, refuse and surface it.
- **Never commit private keys, mnemonics, or RPC keys.** All secrets via `.env`, `.env` is gitignored, `.env.example` is committed with placeholder values.
- **Never hardcode a contract address you have not verified this session.** Verification sources are listed in section 4. If you cannot verify an address, stop and ask the developer rather than guessing. A wrong address on mainnet burns real money.
- **Reuse the existing Spawn codebase.** This is a port, not a rewrite. Before writing anything, inventory the repo (section 6, Phase 0) and adapt. Only write new code where Celo genuinely differs (chain config, Mento, Aave Celo, ERC-8004 registries, fee abstraction).
- **No fake users, no fake feedback, no self-dealing reputation loops that are not performance-derived.** Agents may rate each other ONLY via the fitness function, and the fitness inputs must be onchain-observable (entry value, exit value, timestamps).

## 3. Architecture specification

### 3.1 Components

```
orchestrator (off-chain, long-running process)
  ├── epoch loop: evaluate → cull → spawn → rebalance
  ├── strategy registry (pluggable Strategy interface)
  ├── fitness engine (pure function, recomputable from chain data)
  ├── reputation writer (posts scores to ERC-8004 Reputation Registry)
  ├── activity logger (JSONL: every tx gets {txHash, agentId, action, rationale, timestamp})
  └── kill switch (env flag + SIGINT handler: unwind all positions to cUSD, stop)

swarm agents (N wallets, each with its own ERC-8004 agentId)
  ├── strategy assignment (one strategy + params per agent)
  ├── wallet (derived from a single mnemonic via HD path, index = agent number)
  └── agent card (JSON hosted via the repo's GitHub Pages or a /agents endpoint)

contracts (Solidity, only if the existing Spawn contracts need Celo-specific changes)
  └── prefer redeploying existing audited-by-use Spawn contracts unchanged

dashboard (existing Spawn frontend, re-skinned)
  ├── live swarm view: agents, strategies, fitness, generation tree
  ├── per-agent links to 8004scan and Celoscan
  └── public activity log viewer (the judge-facing transparency layer)
```

### 3.2 Strategy interface

Keep the existing Spawn Strategy interface if one exists. Otherwise:

```typescript
interface Strategy {
  id: string;
  describe(): string; // human-readable, used in rationale logs
  evaluate(ctx: MarketContext): Promise<Action[]>; // returns intents, not raw txs
}
```

Minimum viable strategy set (3 strategies, each with 2-3 param variants so the initial swarm is 6-9 agents):

1. **MentoFXRotator**: holds the Mento stable with the best short-horizon performance vs cUSD (rotate among cUSD, cEUR, cREAL using Mento broker quotes; rotate only when expected edge > swap cost + 0.1%).
2. **AaveYielder**: supplies USDC/USDT/cUSD to Aave v3 Celo, harvests, compounds. Rebalances between assets when supply APY delta > threshold.
3. **HedgedCarry**: holds a yield position on Aave while keeping a fraction in the strongest Mento FX leg. The "evolved" hybrid that demos the Darwinian crossover story.

Action execution must support Celo fee abstraction: pay gas in the stablecoin the agent holds (CIP-64 `feeCurrency` field). viem supports this via the celo chain formatters. This is a demo differentiator (agents never hold CELO) and a real Celo-native feature; use it everywhere it works, fall back to CELO gas only if a given call fails with feeCurrency.

### 3.3 Fitness and evolution

- Epoch length: 4 hours (configurable via env). Short enough to produce visible evolution before the deadline.
- Fitness = (portfolio value in cUSD at epoch end / value at epoch start), annualized, minus a gas-cost penalty. All inputs must be reconstructible from Celoscan by a third party. Document the exact formula in README.
- Cull: bottom 20% of agents each epoch (minimum swarm size 5). Culled agents unwind to cUSD, transfer balance to the spawn pool, and are marked retired (do NOT burn their ERC-8004 identity; retired identities with honest final reputation scores are part of the story).
- Spawn: new agents inherit the top performer's strategy with mutated params. Each new agent gets a fresh HD wallet, a fresh ERC-8004 registration, and a funded balance from the spawn pool. Every spawn = one new unique agent registration, which judges explicitly prioritize.

### 3.4 ERC-8004 integration (this is the track-3 core, do not stub it)

- Register the orchestrator AND every swarm agent in Celo's canonical ERC-8004 Identity Registry. Each registration mints an identity pointing to an agent card JSON (name, description, strategy, endpoints, payment address). Host agent cards at a stable URL (GitHub Pages from this repo is fine).
- After every epoch, the orchestrator posts reputation feedback for each agent to the Reputation Registry: bounded numeric score derived from fitness, plus tags. The feedback author is the orchestrator's own registered identity, and the score derivation is documented publicly. This is performance attestation, not wash reputation; the README must explain this distinction explicitly because judges will look.
- If Celo's deployment supports the Validation Registry, post a validation record per epoch containing the fitness computation inputs (or a hash of the epoch report committed to the activity log). Stretch, not blocking.

### 3.5 x402 loop (stretch, Phase 6 only)

One service agent (ported thin slice of LedgerForge) sells a "market signal" endpoint priced at $0.001-0.01 per call via the thirdweb x402 facilitator on Celo. Swarm agents whose strategy params include `useSignal: true` pay per call before each evaluate(). This creates real x402 payment wallet metrics on 8004scan and the agent-to-agent economy narrative. Do not start this until Phases 1-5 are verified working on mainnet.

## 4. Celo specifics and verification sources

- Chain: Celo mainnet, chain id 42220, RPC `https://forno.celo.org`, explorer celoscan.io. Testnet: Celo Sepolia (Alfajores is deprecated; verify current testnet status in Celo docs before relying on it).
- Celo is an OP Stack L2. Standard EVM tooling works. Use viem with `import { celo } from 'viem/chains'` to get CIP-64 fee currency support.
- Token addresses (cUSD, cEUR, cREAL, USDC, USDT, CELO): verify against docs.celo.org token list before use. Do not trust addresses from blog posts or your own memory.
- Mento: use `@mento-protocol/mento-sdk` for quotes and swaps rather than hand-rolling Broker calls. Verify the SDK supports mainnet pairs we need (cUSD/cEUR, cUSD/cREAL). If the SDK is stale, read the Broker + BiPoolManager addresses from the Mento docs/deployments repo.
- Aave v3 Celo: pull Pool and asset addresses from `@bgd-labs/aave-address-book` (export `AaveV3Celo`). Never hardcode from memory.
- ERC-8004 registries on Celo: get canonical deployment addresses from the official `erc-8004-contracts` repo (the deployments 8004scan indexes) and cross-check on ai.celo.org / docs.celo.org build-with-ai pages. 8004scan only indexes the canonical deployments, so using a custom deployment would zero out track 3. This is the single most important address verification in the project.
- x402: thirdweb SDK (`thirdweb/x402`), `facilitator` + `settlePayment`, `network: celo`. Fee abstraction means the paying agent needs no CELO.
- Self Agent ID: ai.self.xyz. If region-blocked in India, screenshot the unsupported-region message; the hackathon FAQ explicitly accepts this in the submission.

## 5. Repo conventions

- Branch: all work on `celo-hackathon`, branched from main. Conventional commits. Commit at the end of every phase at minimum.
- Keep Celo code isolated: `src/chains/celo/` (or the repo's existing per-chain pattern if one exists from the HashKey/BNB/Solana ports; Phase 0 will tell you). Do not fork the whole codebase.
- `.env.example` must enumerate: `MNEMONIC`, `CELO_RPC_URL`, `EPOCH_HOURS`, `MAX_AGENT_BALANCE_USD`, `TOTAL_BUDGET_USD`, `KILL_SWITCH`, `THIRDWEB_SECRET_KEY` (phase 6 only).
- Scripts (package.json or justfile): `deploy:celo`, `register:agents`, `swarm:start`, `swarm:status`, `swarm:unwind`, `report:epoch`.
- Tests: unit tests for the fitness function (pure, must be deterministic) and for strategy intent generation against mocked market context. Integration: one full epoch dry-run against a fork (anvil fork of Celo mainnet) before any real mainnet transaction.

## 6. Execution phases

**Phase 0 — Inventory (30 min).** Read the existing repo. Produce a short written map: where chain configs live, how Mantle deploy was done, what the Strategy/agent abstractions are, what the dashboard expects. Confirm the plan against this map before coding.

**Phase 1 — Chain plumbing (2-3 h).** Celo chain config, wallet derivation, fee abstraction working (send a $0.01 cUSD transfer paying gas in cUSD on mainnet as the smoke test). Verify all addresses per section 4 and record them in `src/chains/celo/addresses.ts` with a source-URL comment per address.

**Phase 2 — Protocol adapters (3-4 h).** Mento swap adapter + Aave v3 Celo adapter, each with a tiny mainnet smoke test ($1 swap, $2 supply/withdraw). Fork tests first.

**Phase 3 — ERC-8004 (2-3 h).** Agent card hosting, identity registration script, reputation writer. Register the orchestrator + initial swarm. Verify each agent appears on 8004scan.io before proceeding.

**Phase 4 — Swarm live (2-3 h).** Wire strategies, fitness engine, epoch loop, activity logger, kill switch. Start with 6-9 agents on the $50 budget. Run one full epoch supervised end to end. After this phase the swarm runs continuously until submission; transaction count and 8004scan signals accrue with time, so going live early matters more than polish.

**Phase 5 — Dashboard + transparency (2-3 h).** Re-skin existing dashboard, add the public activity log viewer and per-agent 8004scan/Celoscan links, deploy (Vercel or existing host).

**Phase 6 — x402 loop (stretch, 2-3 h).** Per section 3.5.

After every phase: run the smoke tests, commit, and write a 3-line status into `PROGRESS.md` (done / verified-by / next).

## 7. Scope-cut priority if time runs out

Cut in this order: Phase 6, then Validation Registry writes, then dashboard polish (a raw log page is acceptable), then strategy count (2 strategies minimum). Never cut: ERC-8004 identity registrations, reputation writes, activity logging with rationales, the kill switch, budget caps.

## 8. Things that will burn you (gotchas)

- CIP-64 fee currency transactions need the celo-formatted transaction type; a vanilla EIP-1559 tx with a feeCurrency field will be rejected. Use viem's celo chain definition end to end.
- Mento swaps route through the Broker with an exchangeProvider + exchangeId, not a Uniswap-style router. The SDK abstracts this; if you bypass the SDK you must fetch exchangeIds onchain, never hardcode.
- Aave v3 supply needs ERC-20 approve first; batch approve-max once per agent per asset to save transactions that don't tell a story.
- ERC-8004 registration requires the agent card URL to resolve at registration time on some indexer flows; deploy agent card hosting before running the registration script.
- 8004scan indexing can lag; verify registration onchain (read the registry) and treat the UI as eventually consistent.
- Forno public RPC rate-limits; back off with jitter, and keep an alternate RPC URL env var.
- The hackathon requires real activity over time. Day-before-deadline transaction bursts look like gaming the metric. The swarm must be live by end of Day 1.

## 9. Definition of done

- Swarm of 6+ agents live on Celo mainnet, each visible on 8004scan with a resolving agent card.
- At least 3 completed epochs with at least one cull and one spawn (the evolution story must be demonstrable onchain).
- Reputation feedback visible on 8004scan for every active agent.
- Public dashboard URL + public activity log.
- `report:epoch` produces the judge-facing report: tx list with rationales, fitness table, links.
- README submission checklist fully ticked.
- Kill switch tested: one supervised unwind-and-restart cycle completed.