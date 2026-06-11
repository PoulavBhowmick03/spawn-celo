# Spawn Protocol — Celo Hedge Swarm: Verification Ledger

Covers the Celo mainnet deployment (chain 42220) for the Celo Onchain Agents Hackathon.
All checks performed on 2026-06-10 by the orchestrator wallet `0x…` (see `docs/agents/registry.json`).

---

## Phase 0 — Address verification

Every address the swarm touches is stored in `agent/src/chains/celo/addresses.ts`
with a source-URL comment. No address was taken from memory or blog posts.

| Contract | Address | Source verified against |
|---|---|---|
| ERC-8004 Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | Official `erc-8004-contracts` repo deployments + ai.celo.org |
| ERC-8004 Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | Same — the only registry 8004scan indexes |
| Mento Broker | `0x777A8255cA72412f0d706dc03C9D1987306B4CaD` | mento-protocol/mento-core deployments |
| Aave v3 Celo Pool | `0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402` | @bgd-labs/aave-address-book AaveV3Celo |
| USDC (Celo-native) | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | Circle Bridge / docs.celo.org token list |
| USDm (cUSD) | `0x765DE816845861e75A25fCA122bb6898B8B1282a` | docs.celo.org / Mento |
| USDC fee-currency adapter | `0x2F25deB3848986B98BFC67B4a8f4B48Ea16A8B4A` | Celo governance proposals |

**Critical finding (already handled):** The ERC-8004 registry addresses used in
prior deployments (`0x8004A818…`, `0x8004B663…`) have ZERO bytecode on Celo mainnet.
The Celo-native canonical registries above are what 8004scan indexes. All
registrations used the Celo canonical addresses.

---

## Phase 1 — Contract deployment (Celo mainnet, 2026-06-10)

| Contract | Address | Celoscan |
|---|---|---|
| ChildAgent (impl) | `0xd6ac7fee72a4fC9a96aE2B44E17d318666cb23d3` | [verified](https://celoscan.io/address/0xd6ac7fee72a4fC9a96aE2B44E17d318666cb23d3) |
| LineageRegistry | `0x620C51De11E5B3d0F8B5E4439595B70495B18e85` | [verified](https://celoscan.io/address/0x620C51De11E5B3d0F8B5E4439595B70495B18e85) |
| SpawnFactory | `0x670C3Ad2Bc91fBd07720BFbFB7F0F2AF3e3ad85d` | [verified](https://celoscan.io/address/0x670C3Ad2Bc91fBd07720BFbFB7F0F2AF3e3ad85d) |

All deployed with **gas paid in cUSD via CIP-64 fee abstraction** (zero CELO held
by the deployer). Source verified on Celoscan — judges can read the bytecode.

Deployment artifacts: `contracts/broadcast/Deploy.s.sol/42220/run-latest.json`
and `docs/deployments.celo.json`.

---

## Phase 2 — ERC-8004 identity registrations (2026-06-10)

All 9 initial agents + orchestrator registered from their own wallets, paying gas
in cUSD. Each pays their own registration — no orchestrator proxy.

| Agent | 8004scan ID | Registration tx |
|---|---|---|
| Orchestrator | [#9240](https://www.8004scan.io/agents/celo/9240) | Celoscan |
| mfx-cautious | [#9241](https://www.8004scan.io/agents/celo/9241) | Celoscan |
| mfx-balanced | [#9242](https://www.8004scan.io/agents/celo/9242) | Celoscan |
| mfx-aggressive | [#9243](https://www.8004scan.io/agents/celo/9243) | Celoscan |
| ay-anchor | [#9244](https://www.8004scan.io/agents/celo/9244) | Celoscan |
| ay-balanced | [#9245](https://www.8004scan.io/agents/celo/9245) | Celoscan |
| ay-chaser | [#9246](https://www.8004scan.io/agents/celo/9246) | Celoscan |
| hc-light | [#9247](https://www.8004scan.io/agents/celo/9247) | Celoscan |
| hc-mid | [#9248](https://www.8004scan.io/agents/celo/9248) | Celoscan |
| hc-heavy | [#9249](https://www.8004scan.io/agents/celo/9249) | Celoscan |
| Signal Oracle (x402) | [#9258](https://www.8004scan.io/agents/celo/9258) | Celoscan |

All verified: `IERC8004Identity(0x8004A169…).ownerOf(id) == agent.address`.

---

## Phase 3 — Reputation writes (ongoing, post-epoch)

After every epoch the orchestrator posts `giveFeedback` to the Reputation Registry
for every agent (active and retired). The payload is:
```
{score: uint8, data: keccak256(JSON.stringify({epoch,agentId,score,inputs,formula}))}
```

The score derivation formula is published in README.md and is fully recomputable
from Celoscan data. This is performance attestation, not wash reputation — the
Reputation Registry's `feedbackGiver != feedbackReceiver` constraint enforces
this (orchestrator-owned identity gives feedback to agent-owned identities).

---

## Phase 4 — Budget safety (verified in code, 2026-06-10)

- `agent/src/chains/celo/budget.ts`: `assertTxAllowed()` throws `BudgetRefusalError`
  for any single tx exceeding `MAX_TX_USD` or if `KILL_SWITCH` is set.
- Every `executeSwap`, `supplyToAave`, `withdrawFromAave`, `transfer` call checks
  budget before broadcasting.
- Kill switch tested: one supervised unwind-and-restart cycle completed on mainnet.
- Total spend as of 2026-06-10: ≤ $50 (see activity log for running total).

---

## Phase 5 — Fee abstraction (Celo-native, verified)

Every swarm transaction uses CIP-64 `feeCurrency` — agents pay gas in the
stablecoin they hold (cUSD/USDC adapter/USDT adapter). Not one agent holds CELO.
This is verifiable on Celoscan: any agent tx shows a non-null `feeCurrency` field
in the transaction details.

Explicit gas limits on all write calls prevent the CIP-64 pre-debit issue
(estimateGas pre-debits `maxFee × gasLimit` from the fee-currency balance, which
causes near-full-balance transfers to fail during estimation — fixed by setting
explicit gas limits in all write paths).

---

## Open items

None blocking. The ValidationRegistry is not deployed on Celo mainnet — this was
the §3.4 "stretch" item in CLAUDE.md and was correctly omitted.
