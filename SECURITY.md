# Security

This document covers key-hygiene and safety controls for Spawn Protocol —
Celo Hedge Swarm (Celo Onchain Agents Hackathon, 2026).

## Wallet architecture

### HD derivation model
All agent wallets are derived from a single BIP-39 `MNEMONIC` via BIP-44
(coin type 60, Ethereum path):

| HD index | Role |
|---|---|
| 0 | Orchestrator / treasury |
| 1–29 | Swarm agents (initial + spawned) |
| 30 | Signal oracle (x402) |

**Consequence:** the mnemonic is the single root secret for the entire swarm.
One compromised mnemonic gives an attacker full control of every agent wallet.
Protect it accordingly — hardware wallet backup, never in a committed file.

### Key hygiene requirements
- `MNEMONIC` is in `.env`, which is gitignored. Verified: `git ls-files .env` → not tracked.
- `.env` is never copied into Docker images (excluded in `.dockerignore`).
- On Fly.io the mnemonic is a Fly secret (`fly secrets set MNEMONIC=…`), never
  an env var in `fly.celo.toml`.
- Per-agent balance cap: `MAX_AGENT_BALANCE_USD=5`. Even if the mnemonic were
  exposed, each wallet holds at most $5 — total blast radius is bounded.

## Operational safety controls (must remain intact)

### Budget guards (`agent/src/chains/celo/budget.ts`)
- `assertTxAllowed(usdValue, context)` — throws before any write call that
  would exceed `MAX_TX_USD` ($5). Cannot be bypassed without editing source.
- `KILL_SWITCH` env: set to `"true"` to halt all write calls and trigger unwind.
  Works even in the middle of an epoch — the next write call checks it.
- Total budget: `TOTAL_BUDGET_USD=50` checked against the treasury balance at
  epoch start; swarm stops funding new agents if exceeded.
- Slippage: `MAX_SLIPPAGE_BPS=100` (1%) on every Mento swap — computed from live
  Broker quotes, not a static number.

### Kill switch procedure
```bash
# Mac: bash run-celo.sh stop --unwind
# Fly.io: fly secrets set KILL_SWITCH=true -a spawn-celo-swarm
```
Both routes send SIGINT to the swarm process, which unwinds every agent to cUSD
and transfers residuals to the treasury before exiting cleanly.

### CIP-64 fee abstraction safety
All write calls include explicit `gas` limits (120k transfers, 200k settlements,
250k approvals, 900k swaps). This prevents the Celo estimation pre-debit issue
where `eth_estimateGas` pre-debits `maxFee × gasLimit` from the fee-currency
balance — without explicit gas limits, near-full-balance transfers would fail
during estimation with a misleading "insufficient balance" error.

## Reputation integrity

- The orchestrator's ERC-8004 identity (#9240) is the `feedbackGiver` for all
  reputation posts. The Reputation Registry enforces `feedbackGiver ≠ feedbackReceiver`,
  which prevents agents from rating themselves.
- Every reputation score is derived from the published fitness formula (README.md).
  Inputs are: V_start, V_end (onchain balances at epoch boundaries), gas costs
  (Celoscan tx fees). All inputs are publicly verifiable.
- No score is written without a corresponding epoch log entry in `celo_activity.jsonl`.

## Reporting

If you discover a security issue, contact the maintainers privately and rotate
any potentially exposed keys immediately. Do not open a public issue.
