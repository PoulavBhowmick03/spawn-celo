/**
 * Celo mainnet chain plumbing.
 *
 * Uses viem's `celo` chain definition end to end — this is what enables
 * CIP-64 fee-currency transactions (a vanilla EIP-1559 tx with a feeCurrency
 * field is rejected by the node; the celo formatters serialize the correct
 * tx type). See CLAUDE.md §8.
 */

import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type Address,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { celo } from "viem/chains";
import type { LocalAccount } from "viem/accounts";

export { celo };

const RPC_PRIMARY = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const RPC_BACKUP = process.env.CELO_RPC_URL_BACKUP; // forno rate-limits; keep an alternate

/**
 * Shared transport: primary RPC with automatic failover to the backup.
 * http() retries each request 3x with backoff before failing over.
 */
function celoTransport() {
  const transports = [http(RPC_PRIMARY)];
  if (RPC_BACKUP) transports.push(http(RPC_BACKUP));
  return transports.length > 1 ? fallback(transports) : transports[0];
}

// NOTE: annotations must keep `typeof celo` as the chain generic — it carries
// the CIP-64 `feeCurrency` field typing on writes. A bare PublicClient/
// WalletClient annotation would erase it.
export const celoPublicClient: PublicClient<Transport, typeof celo> =
  createPublicClient({
    chain: celo,
    transport: celoTransport(),
  });

/**
 * Wallet client for an agent account. Pass `feeCurrency` on individual
 * calls (sendTransaction/writeContract) to pay gas in that stablecoin —
 * agents never need to hold CELO.
 */
export function celoWalletClient(
  account: LocalAccount,
): WalletClient<Transport, typeof celo, LocalAccount> {
  return createWalletClient({
    account,
    chain: celo,
    transport: celoTransport(),
  });
}

/** Convenience: assert we are actually talking to Celo mainnet before any write. */
export async function assertCeloMainnet(): Promise<void> {
  const id = await celoPublicClient.getChainId();
  if (id !== celo.id) {
    throw new Error(
      `RPC is not Celo mainnet: expected chain id ${celo.id}, got ${id}. Check CELO_RPC_URL.`,
    );
  }
}

export type FeeCurrencyOption = { feeCurrency?: Address };

/**
 * CIP-64 fee currency for live runs; undefined when CELO_NATIVE_GAS=true
 * (anvil fork tests — anvil can't mine fee-currency txs, gas falls back to
 * the fork's prefunded native balance).
 */
export function maybeFee(feeCurrency: Address): Address | undefined {
  return /^(1|true|yes)$/i.test(process.env.CELO_NATIVE_GAS ?? "") ? undefined : feeCurrency;
}
