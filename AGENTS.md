# AGENTS.md - Spawn Protocol: Mantle Edition

This file is the build guide for coding agents working in this repo. The repo is currently restored to the Mantle Turing Complete hackathon stack, not the SwarmOS pivot.

## Current Goal

Spawn Protocol is a Darwinian AI agent swarm on Mantle. A parent process spawns child agents, evaluates them on risk-adjusted yield, recalls underperformers on-chain, writes failure memory to IPFS plus `LineageRegistry`, then respawns successors with the inherited failure context in their Venice prompt.

The active live-yield route is Aave V3 USDe on Mantle. Treat USDe as the Alpha/Data trading strategy asset, not as an RWA. The RWA angle is architectural: the same lineage-memory system can support tokenized real-world yield assets such as Ondo USDY once Mantle liquidity is ready.

## Deployed Mantle Addresses

These are the current v2 decision-proof redeploy addresses. Keep `.env`, `.env.example`, `README.md`, and `plan.md` in sync with these values unless the contracts are intentionally redeployed.

| Component | Address |
|---|---|
| SpawnFactory | `0x94171e5D54792149E14fFa19197e3c17E263C740` |
| LineageRegistry | `0x0466c58d7955cFdfa9E2070077D2f5E26561b59E` |
| ChildAgent implementation | `0xD2d79F4A19E0D77267aBe80d85c33630d0923F72` |
| ERC-8004 Identity Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 Reputation Registry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Aave V3 Pool | `0x458F293454fE0d67EC0655f3672301301DD51422` |
| USDe | `0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34` |
| USDe aToken | `0xb9aCA933C9c0aa854a6DBb7b12f0CC3FdaC15ee7` |

Mantlescan links use `https://mantlescan.xyz/address/<address>`.

## Repository Shape

```text
contracts/   Foundry contracts, deployment scripts, and tests
agent/       TypeScript parent/child runtime using viem
dashboard/   Next.js dashboard and API routes
README.md    Judge-facing overview and quickstart
plan.md      Operational state, runbook, and submission tracker
```

Do not reintroduce the old SwarmOS workspace structure. There should be no root `Anchor.toml`, root Cargo workspace, `programs/`, or `packages/` runtime tree for this branch.

## Contract Model

`SpawnFactory.sol`

1. Deploys EIP-1167 `ChildAgent` clones.
2. Initializes each child with `msg.sender` as parent and the derived child wallet as `wallet`.
3. Attempts ERC-8004 registration.
4. Falls back gracefully to `agentId = 0` if the canonical registry has no bytecode or registration reverts.

`ChildAgent.sol`

1. Stores `parent`, `wallet`, `active`, and `spawnTimestamp`.
2. Rejects zero parent and zero wallet during `initialize()`.
3. Allows only the parent to call `recallChild(reason, ipfsCid)`.
4. Emits recall evidence and marks the child inactive.
5. Allows only the parent to call `recordDecisionHash(hash, actionType, amountBps)`.
6. Emits `AgentDecisionExecuted` so the exact AI decision payload hash can be verified on Mantle.

`LineageRegistry.sol`

1. Stores append-only IPFS CID arrays by `lineageKey`.
2. Emits `LineageUpdated` for post-mortem memory writes.
3. Emits `GenerationResult` for Venice-generated generation summaries.
4. Restricts `pushCID()` and `postGenerationResult()` to allowed callers.

## Runtime Model

`agent/src/parent.ts`

1. Starts the local control server.
2. Derives child wallets from `TREASURY_PRIVATE_KEY`, lineage key, and generation.
3. Funds each child with USDe and MNT in live mode.
4. Calls `SpawnFactory.spawnChild()`.
5. Forks child processes with only `CHILD_PRIVATE_KEY`, not treasury or deployer keys.
6. Evaluates children every 75 seconds by default.
7. Posts generation summaries and recalls underperformers when live flags are enabled.

`agent/src/child.ts`

1. Reads live Aave USDe APY where available.
2. Builds a Venice prompt with ancestor lineage memory.
3. Chooses `AAVE_SUPPLY_USDE`, `AAVE_WITHDRAW_USDE`, `REBALANCE`, or `HOLD` style actions.
4. Executes Aave writes only when `ALLOW_LIVE_CHILD_WRITES=true`.
5. Falls back to simulated/dry-run behavior when live writes are off.

`agent/src/venice.ts`

1. Uses `llama-3.3-70b`.
2. Does not send explicit top-level `enable_e2ee`; current Venice API rejects that field.
3. Strips markdown JSON fences before `JSON.parse()`.
4. Falls back to deterministic reasoning when the Venice API key is absent or the request fails.

`agent/src/ipfs.ts`

1. Pins post-mortem JSON through Filebase (S3-compatible IPFS, AWS Sig V4).
2. Requires `FILEBASE_API_KEY` and `FILEBASE_SECRET` for real final evidence. CID is returned via `x-amz-meta-cid` response header.
3. Local fallback CIDs are acceptable for development only.

## Deployer Wallet Setup

The deployer key is stored as an encrypted Foundry keystore at `~/.foundry/keystores/myaccount`. Do not print, log, or commit the raw private key.

**Rules for all agents:**

- Never print, log, or echo the value of `DEPLOYER_PRIVATE_KEY`.
- Never commit `.env`. It is in `.gitignore`. Public addresses belong in `.env.example` only.
- For `forge script` deployments, prefer the Foundry keystore:

  ```bash
  forge script contracts/script/<Script>.s.sol \
    --rpc-url $MANTLE_RPC \
    --account myaccount \
    --password-file ~/.foundry/keystores/.myaccount.pass \
    --broadcast
  ```

- For `cast send`, prefer:

  ```bash
  cast send <address> <sig> <args> \
    --rpc-url $MANTLE_RPC \
    --account myaccount \
    --password-file ~/.foundry/keystores/.myaccount.pass
  ```

- The TypeScript parent runtime still uses `DEPLOYER_PRIVATE_KEY` for live viem writes such as `spawnChild()`, `recallChild()`, and `recordDecisionHash()`. If live runtime flags are enabled, `.env` must contain that key or the parent will fall back/dry-run those writes.

The keystore format is ERC-55 v3 (AES-128-CTR encrypted). The file at `~/.foundry/keystores/myaccount` does **not** contain a plaintext private key — decryption requires the password the user set via `cast wallet import`.

## Environment Variables

`.env` is ignored and may contain private keys. Never print or commit it. Public addresses belong in `.env.example`, `README.md`, and `plan.md`.

Minimum runtime shape:

```env
DEPLOYER_PRIVATE_KEY=0x...
TREASURY_PRIVATE_KEY=0x...
CHILD_GAS_STIPEND_MNT=0.05

MANTLE_RPC=https://rpc.mantle.xyz
MANTLE_EXPLORER_API_KEY=

SPAWN_FACTORY_ADDRESS=0x94171e5D54792149E14fFa19197e3c17E263C740
LINEAGE_REGISTRY_ADDRESS=0x0466c58d7955cFdfa9E2070077D2f5E26561b59E
CHILD_AGENT_IMPLEMENTATION=0xD2d79F4A19E0D77267aBe80d85c33630d0923F72

ERC8004_REGISTRY_ADDRESS=0x8004A818BFB912233c491871b3d84c89A494BD9e
REPUTATION_REGISTRY_ADDRESS=0x8004B663056A597Dffe9eCcC1965A193B7388713

AAVE_POOL_ADDRESS=0x458F293454fE0d67EC0655f3672301301DD51422
USDE_ADDRESS=0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34
USDE_ATOKEN=0xb9aCA933C9c0aa854a6DBb7b12f0CC3FdaC15ee7
USDE_DECIMALS=18
AAVE_USDE_BENCHMARK=7.47

VENICE_API_KEY=
FILEBASE_API_KEY=
FILEBASE_SECRET=
FILEBASE_BUCKET=spawn-yield
IPFS_GATEWAY_BASE=https://ipfs.filebase.io/ipfs

NEXT_PUBLIC_API_URL=http://localhost:8787
NEXT_PUBLIC_SPAWN_FACTORY_ADDRESS=0x94171e5D54792149E14fFa19197e3c17E263C740
NEXT_PUBLIC_LINEAGE_REGISTRY_ADDRESS=0x0466c58d7955cFdfa9E2070077D2f5E26561b59E
NEXT_PUBLIC_ERC8004_IDENTITY_REGISTRY=0x8004A818BFB912233c491871b3d84c89A494BD9e
```

Live flags stay commented until the treasury is funded and smoke tests pass:

```env
# ALLOW_LIVE_SPAWN=true
# ALLOW_LIVE_RECALL=true
# ALLOW_LIVE_CHILD_WRITES=true
# ALLOW_LIVE_GENERATION_POSTS=true
```

## Commands

Install dependencies:

```bash
cd agent && npm install && cd ..
cd dashboard && npm install && cd ..
cd contracts && forge install && cd ..
```

Run contract tests:

```bash
cd contracts
forge test
```

Current expected result: `134` passing, `0` failed, `2` expected skips on Mantle fork checks.

Run agent typecheck:

```bash
cd agent
npx tsc --noEmit
```

Build dashboard:

```bash
cd dashboard
npm run build
```

Dashboard lint currently has legacy strict `no-explicit-any` violations. Do not treat that as a Mantle restore blocker unless the task is explicitly to clean dashboard lint.

Run parent in dry-run mode:

```bash
node --env-file=.env --import agent/node_modules/tsx/dist/esm/index.cjs agent/src/parent.ts
```

Run live only after funding and smoke tests:

```bash
ALLOW_LIVE_SPAWN=true \
ALLOW_LIVE_RECALL=true \
ALLOW_LIVE_CHILD_WRITES=true \
ALLOW_LIVE_GENERATION_POSTS=true \
node --env-file=.env --import agent/node_modules/tsx/dist/esm/index.cjs agent/src/parent.ts
```

## Live Launch Preconditions

1. Treasury has at least `75` USDe for five children at `15` USDe each.
2. Treasury has MNT for ERC20 transfer gas.
3. Deployer or child gas funder has enough MNT for child stipends and orchestration transactions.
4. Filebase smoke test: `pinToIPFS({})` returns a real `Qm...` CID (not `local:`).
5. Dry-run parent process starts, forks children, and updates local state/events.
6. Dashboard can reach the control server through `NEXT_PUBLIC_API_URL`.

## Documentation Rules

1. Keep public addresses in sync across `.env.example`, `README.md`, `plan.md`, and this file.
2. Do not paste private keys, API keys, JWTs, wallet seed material, or full `.env` contents into committed files.
3. Do not claim USDe is an RWA.
4. Do not claim ERC-8004 registration is live while the canonical registry has no bytecode on Mantle.
5. Do not claim Gen 3 beats Gen 1 until live on-chain data proves it.
6. Do not use local fallback CIDs as final IPFS evidence.
