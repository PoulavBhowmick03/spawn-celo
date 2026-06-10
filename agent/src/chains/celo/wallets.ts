/**
 * Wallet derivation for the Celo swarm.
 *
 * Single MNEMONIC in .env, standard BIP-44 HD derivation
 * (m/44'/60'/0'/0/index). Index 0 is the orchestrator; swarm agents are
 * 1..N (index = agent number, per CLAUDE.md §3.1). Confirmed by developer
 * in Phase 0 decision 2 — this replaces the Mantle-era keccak(treasuryKey,
 * lineage, generation) derivation.
 *
 * Every agent address is therefore independently derivable by anyone holding
 * the mnemonic, and each agent has its own clean Celoscan history.
 */

import { mnemonicToAccount, type HDAccount } from "viem/accounts";

export const ORCHESTRATOR_INDEX = 0;

function requireMnemonic(): string {
  const mnemonic = process.env.MNEMONIC;
  if (!mnemonic || mnemonic.trim().split(/\s+/).length < 12) {
    throw new Error(
      "MNEMONIC missing or malformed in .env (need a 12/24-word BIP-39 phrase).",
    );
  }
  return mnemonic.trim();
}

/** Derive the account at a given HD index. Index 0 = orchestrator. */
export function deriveAccount(index: number): HDAccount {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid HD index ${index}`);
  }
  return mnemonicToAccount(requireMnemonic(), { addressIndex: index });
}

export const orchestratorAccount = () => deriveAccount(ORCHESTRATOR_INDEX);

/** Agent N lives at HD index N (1-based; 0 is reserved for the orchestrator). */
export function agentAccount(agentNumber: number): HDAccount {
  if (agentNumber < 1) {
    throw new Error(
      `Agent numbers start at 1 (index 0 is the orchestrator); got ${agentNumber}`,
    );
  }
  return deriveAccount(agentNumber);
}
