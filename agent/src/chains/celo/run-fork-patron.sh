#!/usr/bin/env bash
# End-to-end patron (external sponsorship) flow on an anvil fork of Celo mainnet.
# Simulates a real non-swarm user depositing cUSD to the treasury and asserts
# the swarm detects it and spawns a sponsored ERC-8004 agent against the real
# (forked) registries. No real funds move; docs/ writes are reverted after.
set -euo pipefail
cd "$(dirname "$0")/../../.."          # -> agent/
AGENT="$(pwd)"
ROOT="$(cd .. && pwd)"                 # repo root
cd "$AGENT"

FORK_RPC="${FORK_SOURCE_RPC:-https://forno.celo.org}"
PORT=8547
anvil --fork-url "$FORK_RPC" --port $PORT --silent &
ANVIL_PID=$!
# revert any docs/ writes the spawn made (patron card + registry entry) and
# kill anvil on exit, success or failure
cleanup() {
  kill $ANVIL_PID 2>/dev/null || true
  git -C "$ROOT" checkout -- docs/ 2>/dev/null || true
  git -C "$ROOT" clean -fdq docs/agents 2>/dev/null || true
}
trap cleanup EXIT
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT"; then break; fi
  sleep 0.5
done

export CELO_RPC_URL="http://127.0.0.1:$PORT"
export CELO_RPC_URL_BACKUP=""
export CELO_NATIVE_GAS=true        # anvil can't mine CIP-64 txs
export CELO_NO_PUBLISH=true        # no git pushes; also skips waitForCard
export CELO_SWARM_STATE=/tmp/celo_patron_fork_state.json
export CELO_ACTIVITY_LOG=/tmp/celo_patron_fork_activity.jsonl
rm -f "$CELO_SWARM_STATE" "$CELO_ACTIVITY_LOG"

# native gas for the wallets the test touches (HD 0 treasury, 1 seed, 100 spawn, 777 patron)
npx tsx -e "
import * as dotenv from 'dotenv';
import { mnemonicToAccount } from 'viem/accounts';
dotenv.config({ path: '../.env' });
const m = process.env.MNEMONIC!;
const idx = [0,1,30,100,777];
Promise.all(idx.map(i => {
  const a = mnemonicToAccount(m, { addressIndex: i });
  return fetch('http://127.0.0.1:$PORT', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:i,method:'anvil_setBalance',params:[a.address,'0x8AC7230489E80000']}) });
})).then(() => console.log('native gas funded for HD indices', idx.join(',')));
"

echo "=== patron flow end-to-end (deposit -> detect -> enqueue -> fund -> register -> live agent) ==="
npx tsx src/chains/celo/patron-fork-test.ts
