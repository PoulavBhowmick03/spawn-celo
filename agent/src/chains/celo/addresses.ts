/**
 * Celo mainnet (chain id 42220) addresses.
 *
 * EVERY address in this file was verified on 2026-06-10 by three checks:
 *   1. an authoritative source (URL in the comment above each address),
 *   2. a cross-check source where one exists,
 *   3. a live read against forno.celo.org (ERC-20 symbol()/decimals() for
 *      tokens, getCode() bytecode presence for contracts; fee currencies
 *      confirmed via FeeCurrencyDirectory.getCurrencies(), itself resolved
 *      from the Celo core registry 0x...ce10 getAddressForString()).
 *
 * Naming note: Mento rebranded its stables in 2026 — onchain symbols are now
 * USDm (was cUSD), EURm (was cEUR), BRLm (was cREAL). Addresses are unchanged
 * from the legacy names. We keep the legacy aliases because the hackathon
 * brief and most Celo docs still say cUSD/cEUR/cREAL.
 */

import type { Address } from "viem";

export const CELO_CHAIN_ID = 42220;

// ---------------------------------------------------------------------------
// Tokens
// Source: https://docs.celo.org/contracts/token-contracts
// Cross-check: @bgd-labs/aave-address-book AaveV3Celo.ASSETS (USDm/EURm/USDC/USDT/CELO)
// ---------------------------------------------------------------------------
export const TOKENS = {
  /** Mento Dollar — onchain symbol USDm, legacy name cUSD. 18 decimals. Valid fee currency. */
  USDm: "0x765DE816845861e75A25fCA122bb6898B8B1282a" as Address,
  /** Mento Euro — onchain symbol EURm, legacy name cEUR. 18 decimals. Valid fee currency. */
  EURm: "0xD8763CBa276a3738E6DE85b4b3bF5FDed6D6cA73" as Address,
  /** Mento Brazilian Real — onchain symbol BRLm, legacy name cREAL. 18 decimals. Valid fee currency. */
  BRLm: "0xe8537a3d056DA446677B9E9d6c5dB704EaAb4787" as Address,
  /** Native USDC (Circle). 6 decimals. NOT a direct fee currency (use FEE_CURRENCIES.USDC_ADAPTER). */
  USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as Address,
  /** Tether USD — onchain symbol USD₮. 6 decimals. NOT a direct fee currency (adapter exists). */
  USDT: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as Address,
  /** CELO native token (ERC-20 interface to the native asset). 18 decimals. */
  CELO: "0x471EcE3750Da237f93B8E339c536989b8978a438" as Address,
} as const;

/** Legacy-name aliases (hackathon brief / older docs). Same contracts as above. */
export const cUSD = TOKENS.USDm;
export const cEUR = TOKENS.EURm;
export const cREAL = TOKENS.BRLm;

export const TOKEN_DECIMALS: Record<keyof typeof TOKENS, number> = {
  USDm: 18,
  EURm: 18,
  BRLm: 18,
  USDC: 6,
  USDT: 6,
  CELO: 18,
};

// ---------------------------------------------------------------------------
// CIP-64 fee abstraction
// Source: FeeCurrencyDirectory resolved onchain from the Celo core registry
//   (0x000000000000000000000000000000000000ce10, getAddressForString
//   ("FeeCurrencyDirectory")) and enumerated via getCurrencies() on 2026-06-10.
// Docs: https://docs.celo.org/build-on-celo/fee-abstraction/using-fee-abstraction
// ---------------------------------------------------------------------------
export const FEE_CURRENCY_DIRECTORY =
  "0x15F344b9E6c3Cb6F0376A36A64928b13F62C6276" as Address;

export const FEE_CURRENCIES = {
  /** Pay gas in cUSD/USDm — the token itself is whitelisted. Our default. */
  USDm: TOKENS.USDm,
  /** Pay gas in cEUR/EURm. */
  EURm: TOKENS.EURm,
  /** Pay gas in cREAL/BRLm. */
  BRLm: TOKENS.BRLm,
  /**
   * USDC fee adapter (18-decimal wrapper over 6-decimal USDC).
   * Listed in FeeCurrencyDirectory.getCurrencies(); the underlying USDC
   * contract is NOT itself a valid feeCurrency value.
   */
  USDC_ADAPTER: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B" as Address,
  /** USDT fee adapter (18-decimal wrapper, symbol USD₮ decimals=18 in directory). */
  USDT_ADAPTER: "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72" as Address,
} as const;

// ---------------------------------------------------------------------------
// Mento protocol
// Source: @mento-protocol/mento-sdk `addresses[42220]` (the SDK we use for
//   quotes/swaps, so these are definitionally the addresses it will call).
// Docs: https://docs.mento.org/mento/developers/deployments/addresses
// ---------------------------------------------------------------------------
export const MENTO = {
  BROKER: "0x777A8255cA72412f0d706dc03C9D1987306B4CaD" as Address,
  BI_POOL_MANAGER: "0x22d9db95E6Ae61c104A7B6F6C78D7993B94ec901" as Address,
} as const;

// ---------------------------------------------------------------------------
// Aave v3 Celo
// Source: @bgd-labs/aave-address-book export AaveV3Celo (per CLAUDE.md §4 this
//   package is the only allowed source for Aave addresses).
//   https://github.com/bgd-labs/aave-address-book
// ---------------------------------------------------------------------------
export const AAVE_V3 = {
  POOL: "0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402" as Address,
  PROTOCOL_DATA_PROVIDER: "0x2e0f8D3B1631296cC7c56538D6Eb6032601E15ED" as Address,
  ATOKENS: {
    USDC: "0xFF8309b9e99bfd2D4021bc71a362aBD93dBd4785" as Address,
    USDT: "0xDeE98402A302e4D707fB9bf2bac66fAEEc31e8Df" as Address,
    /** aToken for USDm (cUSD). */
    USDm: "0xBba98352628B0B0c4b40583F593fFCb630935a45" as Address,
  },
} as const;

// ---------------------------------------------------------------------------
// ERC-8004 canonical registries (Celo mainnet)
// THE track-3-critical addresses. Triple-verified 2026-06-10:
//   1. https://github.com/erc-8004/erc-8004-contracts (canonical deployments,
//      deterministic across 30+ chains — same address on every mainnet)
//   2. https://docs.celo.org/build-on-celo/build-with-ai/8004
//   3. getCode() on forno: both have live bytecode (proxies).
// NOTE: the 0x8004A818... / 0x8004B663... addresses found in the Mantle-era
// .env are the TESTNET deployments — zero bytecode on Celo mainnet. Do not use.
// NOTE: ValidationRegistry is NOT deployed on Celo mainnet (per the canonical
// repo). The CLAUDE.md §3.4 validation-record stretch goal is therefore moot.
// ---------------------------------------------------------------------------
export const ERC8004 = {
  IDENTITY_REGISTRY: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address,
  REPUTATION_REGISTRY: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as Address,
} as const;

// ---------------------------------------------------------------------------
// Spawn Protocol contracts — OUR deployment on Celo mainnet (2026-06-10),
// bytecode identical to the audited-by-use Mantle deployment, deployed by the
// orchestrator (0xC0296012…50e0) with CIP-64 cUSD gas via deploy-contracts.ts.
// Deploy txs recorded in docs/deployments.celo.json. SpawnFactory's in-factory
// ERC-8004 registration is intentionally inert on Celo (its constant points at
// the testnet registry, no bytecode here → graceful agentId=0): identities are
// minted by the runtime from each agent's own wallet instead (see identity.ts).
// ---------------------------------------------------------------------------
export const SPAWN = {
  LINEAGE_REGISTRY: "0x620C51De11E5B3d0F8B5E4439595B70495B18e85" as Address,
  CHILD_AGENT_IMPL: "0xd6ac7fee72a4fC9a96aE2B44E17d318666cb23d3" as Address,
  SPAWN_FACTORY: "0x670C3Ad2Bc91fBd07720BFbFB7F0F2AF3e3ad85d" as Address,
} as const;

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------
export const EXPLORER = "https://celoscan.io";
export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER}/address/${addr}`;
export const SCAN_8004 = "https://www.8004scan.io";
