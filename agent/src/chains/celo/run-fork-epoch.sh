#!/usr/bin/env bash
# Full-epoch dry-run on an anvil fork of Celo mainnet (CLAUDE.md §5):
# init (fund 9 agents + spawnChild provenance) -> epoch 1 evaluate/execute ->
# settle (fitness, reputation feedback, bottom-20% cull with unwind-to-treasury).
# No real funds move; spawn-replacement and docs publishing are skipped (they
# need GitHub Pages, which a fork can't see).
set -euo pipefail
FORK_RPC="${FORK_SOURCE_RPC:-https://forno.celo.org}"
PORT=8546
anvil --fork-url "$FORK_RPC" --port $PORT --silent &
ANVIL_PID=$!
trap "kill $ANVIL_PID 2>/dev/null || true" EXIT
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT"; then break; fi
  sleep 0.5
done

export CELO_RPC_URL="http://127.0.0.1:$PORT"
export CELO_RPC_URL_BACKUP=""
export CELO_NATIVE_GAS=true        # anvil can't mine CIP-64 txs
export CELO_NO_PUBLISH=true        # no git pushes from a fork test
export CELO_SKIP_SPAWN=true        # spawned cards can't resolve from a fork
export ALLOW_LIVE_SWARM=true       # "live" against the fork only
export CELO_SWARM_STATE=/tmp/celo_fork_swarm_state.json
export CELO_ACTIVITY_LOG=/tmp/celo_fork_activity.jsonl
rm -f "$CELO_SWARM_STATE" "$CELO_ACTIVITY_LOG"

# native gas for all wallets (HD 0-9) on the fork
npx tsx -e "
import * as dotenv from 'dotenv';
import { mnemonicToAccount } from 'viem/accounts';
dotenv.config({ path: '../.env' });
const m = process.env.MNEMONIC!;
const reqs = [];
for (let i = 0; i <= 9; i++) {
  const a = mnemonicToAccount(m, { addressIndex: i });
  reqs.push(fetch('http://127.0.0.1:$PORT', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:i,method:'anvil_setBalance',params:[a.address,'0x8AC7230489E80000']}) }));
}
Promise.all(reqs).then(() => console.log('native gas funded for HD indices 0-9'));
"

echo "=== pass 1: init + fund + provenance + epoch 1 start ==="
npx tsx src/chains/celo/swarm-start.ts --once

echo "=== pass 2: settle epoch 1 (fitness -> reputation -> cull/unwind) + start epoch 2 ==="
npx tsx src/chains/celo/swarm-start.ts --once

echo "=== final status ==="
npx tsx src/chains/celo/swarm-status.ts
