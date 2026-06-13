/**
 * Patron deposits (external sponsorship of swarm agents).
 *
 * Anyone can send cUSD to the swarm treasury from their own wallet. This
 * module detects those deposits onchain and turns each one into a new agent
 * spawned in the sponsor's name — a real ERC-8004 identity that competes in
 * the swarm exactly like a developer-funded agent. It is a *sponsorship of an
 * autonomous experiment*, NOT a custodial deposit: there is no withdrawal,
 * and the disclosure says so. No new contract — a deposit is a plain cUSD
 * ERC-20 transfer, so the whole flow is verifiable from Celoscan.
 *
 * Detection is deliberately conservative:
 *   - only scans from the block recorded the first time this runs (so the
 *     developer's historical treasury setup / Mento credits are never seen),
 *   - excludes every swarm-owned wallet as a sender (this is what stops agent
 *     cull-unwinds — which also send cUSD to the treasury — from being read
 *     as deposits),
 *   - excludes a small set of known protocol contracts (defence in depth),
 *   - dedupes by deposit txHash so each deposit spawns exactly one agent.
 */

import { erc20Abi, formatUnits, getAddress, parseAbiItem, type Address, type Hex } from "viem";
import { TOKENS } from "./addresses.js";
import { celoPublicClient } from "./chain.js";
import { orchestratorAccount, deriveAccount } from "./wallets.js";
import type { SwarmState } from "./swarm-state.js";

/** Minimum sponsorship that spawns an agent. Low so judges can try it cheaply. */
export const MIN_PATRON_USD = 1.0;
/** HD index of the x402 signal oracle (excluded from patron detection). */
const SIGNAL_ORACLE_HD_INDEX = 30;
/** forno caps eth_getLogs ranges; stay well under it. */
const MAX_LOG_RANGE = 9000n;

/** Protocol contracts that move cUSD into the treasury for non-sponsorship
 *  reasons (Mento broker/pools, fee adapters). Defence in depth on top of the
 *  swarm-wallet exclusion and the start-at-deploy scan window. */
const NON_PATRON_SENDERS = new Set(
  [
    "0x777A8255cA72412f0d706dc03C9D1987306B4CaD", // Mento Broker (verified, addresses.ts)
    "0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402", // Aave v3 Pool (verified, addresses.ts)
  ].map((a) => a.toLowerCase()),
);

export type PatronDeposit = {
  depositor: Address;
  depositTx: Hex;
  amountUsd: number;
  block: bigint;
};

/** Deterministic lineage key / UI match key for a sponsor address. */
export function patronLineageKey(depositor: string): string {
  return `patron-${depositor.slice(2, 8).toLowerCase()}`;
}

/** Every wallet the swarm itself controls — senders to exclude. Includes all
 *  agents (active AND retired, so cull-unwinds are excluded), the orchestrator,
 *  and the signal oracle. */
function swarmAddressSet(state: SwarmState): Set<string> {
  const set = new Set<string>();
  for (const a of state.agents) set.add(a.address.toLowerCase());
  set.add(orchestratorAccount().address.toLowerCase());
  set.add(deriveAccount(SIGNAL_ORACLE_HD_INDEX).address.toLowerCase());
  return set;
}

/**
 * Detect new external cUSD deposits to the treasury since the last scan.
 * Mutates state.patronScanFromBlock (advances the cursor) but does NOT mark
 * deposits processed — the caller does that once a spawn is enqueued, so a
 * crash between detect and enqueue simply re-detects next cycle.
 */
export async function detectPatronDeposits(state: SwarmState): Promise<PatronDeposit[]> {
  const treasury = orchestratorAccount().address;
  // cacheTime:0 — viem caches getBlockNumber; we need the true chain head so
  // the scan window always covers freshly-mined deposit blocks
  const head = await celoPublicClient.getBlockNumber({ cacheTime: 0 });

  // First run: start watching from here. Never look backwards — that is what
  // guarantees historical setup transfers are out of scope.
  if (state.patronScanFromBlock === undefined) {
    state.patronScanFromBlock = head.toString();
    return [];
  }

  let from = BigInt(state.patronScanFromBlock);
  if (from > head) {
    state.patronScanFromBlock = head.toString();
    return [];
  }

  const swarm = swarmAddressSet(state);
  const processed = new Set((state.processedDeposits ?? []).map((h) => h.toLowerCase()));
  const transferEvent = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  );
  const deposits: PatronDeposit[] = [];

  // page through the range in MAX_LOG_RANGE chunks
  let cursor = from;
  while (cursor <= head) {
    const to = cursor + MAX_LOG_RANGE - 1n > head ? head : cursor + MAX_LOG_RANGE - 1n;
    const logs = await celoPublicClient.getLogs({
      address: TOKENS.USDm,
      event: transferEvent,
      args: { to: treasury },
      fromBlock: cursor,
      toBlock: to,
    });
    for (const log of logs) {
      const sender = (log.args.from ?? "0x").toLowerCase();
      const txHash = (log.transactionHash ?? "0x") as Hex;
      if (!log.args.from || !log.args.value) continue;
      if (swarm.has(sender) || NON_PATRON_SENDERS.has(sender)) continue;
      if (processed.has(txHash.toLowerCase())) continue;
      const amountUsd = Number(formatUnits(log.args.value, 18));
      if (amountUsd < MIN_PATRON_USD) continue;
      // one spawn per deposit tx (a tx with multiple qualifying transfers is
      // still one sponsorship)
      if (deposits.some((d) => d.depositTx.toLowerCase() === txHash.toLowerCase())) continue;
      deposits.push({
        depositor: getAddress(log.args.from),
        depositTx: txHash,
        amountUsd,
        block: log.blockNumber ?? head,
      });
    }
    cursor = to + 1n;
  }

  // advance the cursor past everything we just scanned
  state.patronScanFromBlock = (head + 1n).toString();
  return deposits;
}
