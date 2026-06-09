# Security

This document records the key-hygiene and security findings for Spawn Protocol
(Mantle Edition) and the actions required to remediate them. It is derived from
the end-to-end audit (`AUDIT.md`). It is intentionally concise and actionable.

## Key-hygiene findings (action required)

### 1. Deployer and Treasury are the SAME key
`DEPLOYER_PRIVATE_KEY` and `TREASURY_PRIVATE_KEY` currently resolve to the **same
private key** (address `0xC0296012Cfbb0e6DF5dA7158B65Dbc46DD9650e0`). This means
one compromised key gives an attacker both contract-ownership powers (deployer)
and direct control of treasury funds.

**Recommendation:** Use **separate** deployer and treasury keys. The deployer key
should hold no funds beyond gas and ideally be moved to a hardware wallet or
multisig after deployment. The treasury key should be the only key with custody
of spendable assets, and should be rotated independently.

### 2. Child wallet keys are derived from the treasury key using PUBLIC inputs
Child agent wallet keys are derived **deterministically** from the treasury key
combined with **public** inputs (the lineage key and the generation index). Both
derivation inputs are visible on-chain / in logs and the dashboard.

**Consequence:** Anyone who obtains the treasury key can regenerate **every**
child wallet key (past, present, and future) and drain all child wallets — the
public derivation inputs provide no additional protection.

**Recommendation:**
- Treat the treasury key as the single root secret protecting the entire swarm,
  and protect it accordingly (HSM / KMS / hardware wallet, never in plaintext
  `.env` on a shared or committed machine).
- Treat child-key derivation inputs as **sensitive** even though they are
  currently public — or, better, derive child keys from a secret salt that is
  not the treasury key and is not published on-chain, so a treasury-key leak does
  not automatically expose every child wallet.
- Keep per-child balances minimal (just enough for the live position + gas) to
  cap blast radius.

### 3. The committed/exposed key is funded and must be rotated
The key currently referenced by the project `.env` is **funded** and was
**exposed** during development. Even though `.env` is gitignored (verified: not
tracked), the key value has been handled outside a secure boundary.

**Recommendation:** **Rotate** this key now. Move all funds to a fresh key
generated in a secure environment, update `.env` (locally, never committed),
and never reuse the exposed key.

## Operational safety controls (in place)

These controls exist in the codebase and MUST remain intact:

- **`ALLOW_LIVE_*` flag gating** on every broadcasting code path. Default behavior
  is **dry-run** (pseudo tx hashes); no real transaction is sent unless the
  corresponding flag is explicitly set to `"true"`
  (`ALLOW_LIVE_SPAWN`, `ALLOW_LIVE_RECALL`, `ALLOW_LIVE_CHILD_WRITES`,
  `ALLOW_LIVE_GENERATION_POSTS`).
- **`update-values.ts`** (broadcasts `setGovernanceValues`) is now gated behind
  `ALLOW_LIVE_GOVERNANCE_WRITE === "true"` and refuses to run otherwise. Do not
  remove this gate.
- **Legacy demo scripts** (`demo.ts`, `demo-crosschain.ts`, `verify-live-vote.ts`)
  are marked non-functional and hard-exit unless explicitly forced
  (`ALLOW_LEGACY_DEMO` / `ALLOW_LEGACY_VERIFY`). They target a deprecated
  Base/Celo Sepolia deployment and a contract API (`spawnChildWithOperator`) that
  does not exist on the deployed Mantle SpawnFactory; running them against live
  Mantle would revert.

When enabling any `ALLOW_LIVE_*` flag, follow the spend gate discipline in
`AUDIT.md`: resolve the asset/amount story, confirm a valid dry-run produces
correct calldata, and ensure worst-case spend is well below available funds.

## Open items — pending human sign-off

The following are **decisions for a human**, not implemented here. Listed so they
are not lost.

- **(P4 Option B) USDC → USDe swap for USDC seeding.** Seeding children in USDC
  would require a USDC→USDe swap (e.g. via Merchant Moe). This adds swap risk
  (hardcoded pair, slippage/exit-slippage exposure) and is not currently wired.
  Decide whether to support USDC seeding via a swap, or keep seeding in USDe only.

- **(5a) ERC-8004 identity / reputation registries have ZERO bytecode on Mantle.**
  The identity (`0x8004A818…`) and reputation (`0x8004B663…`) registry addresses
  have **no contract code** on Mantle (confirmed by `cast code` and a self-skipping
  integration test). Any UI/runtime feature that claims to read identity/reputation
  from these addresses is **not** reading live Mantle data. Decide whether to
  **deploy** these registries to Mantle, or **remove** the features/claims that
  depend on them.

## Reporting

If you discover a security issue, do not open a public issue. Contact the
maintainers privately and rotate any potentially exposed keys immediately.
