#!/usr/bin/env bash
# Swarm supervisor: relaunches on crashes (RPC receipt timeouts etc — every
# step is idempotent/resumable), stops on a clean exit (kill switch).
cd "$(dirname "$0")/../../.."
while true; do
  ALLOW_LIVE_SWARM=true EPOCH_HOURS="${EPOCH_HOURS:-4}" TICK_MINUTES="${TICK_MINUTES:-60}" \
    npx tsx src/chains/celo/swarm-start.ts
  code=$?
  if [ $code -eq 0 ]; then
    echo "[supervisor] clean exit (kill switch) — stopping"
    break
  fi
  echo "[supervisor] swarm exited with code $code — relaunching in 30s"
  sleep 30
done
