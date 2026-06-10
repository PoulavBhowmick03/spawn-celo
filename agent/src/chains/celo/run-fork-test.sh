#!/usr/bin/env bash
# Starts an anvil fork of Celo mainnet, runs fork-test.ts against it, tears down.
set -euo pipefail
FORK_RPC="${FORK_SOURCE_RPC:-https://forno.celo.org}"
PORT=8545
anvil --fork-url "$FORK_RPC" --port $PORT --silent &
ANVIL_PID=$!
trap "kill $ANVIL_PID 2>/dev/null || true" EXIT
# wait for anvil to be ready
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT"; then break; fi
  sleep 0.5
done
CELO_RPC_URL="http://127.0.0.1:$PORT" CELO_RPC_URL_BACKUP="" npx tsx src/chains/celo/fork-test.ts
