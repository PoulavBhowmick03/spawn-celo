#!/usr/bin/env bash
# Spawn Hedge Swarm on Celo — unified stack runner.
#
#   ./run-celo.sh start     # kill strays, start sleep-guard + signal oracle + supervised swarm
#   ./run-celo.sh stop      # stop everything (positions STAY deployed; resume-safe)
#   ./run-celo.sh stop --unwind   # kill switch: unwind every agent to the treasury, then stop
#   ./run-celo.sh status    # what's running + swarm state summary
#   ./run-celo.sh logs      # tail the swarm + oracle logs
#
# Components:
#   caffeinate                 keeps the Mac awake (the swarm must run 24/7)
#   signal-service.ts          x402 signal oracle on :8402
#   run-swarm-supervised.sh    epoch loop under a crash-restart supervisor
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
AGENT="$ROOT/agent"
LOG_DIR="${CELO_LOG_DIR:-/tmp/spawn-celo}"
mkdir -p "$LOG_DIR"

swarm_pids()  { pgrep -f "src/chains/celo/swarm-start.ts" || true; }
oracle_pids() { pgrep -f "src/chains/celo/signal-service.ts" || true; }
super_pids()  { pgrep -f "run-swarm-supervised.sh" || true; }

kill_all() {
  # supervisor first so it can't relaunch what we're stopping
  for p in $(super_pids); do kill -9 "$p" 2>/dev/null || true; done
  for p in $(swarm_pids); do kill -9 "$p" 2>/dev/null || true; done
  for p in $(oracle_pids); do kill -9 "$p" 2>/dev/null || true; done
  sleep 1
}

start() {
  echo "── cleaning up strays (prevents duplicate swarms = duplicate txs)"
  kill_all

  echo "── sleep guard"
  pgrep -x caffeinate >/dev/null || (nohup caffeinate -dims >/dev/null 2>&1 &)

  echo "── x402 signal oracle (:${SIGNAL_PORT:-8402})"
  (cd "$AGENT" && nohup npx tsx src/chains/celo/signal-service.ts >> "$LOG_DIR/oracle.log" 2>&1 &)
  for i in $(seq 1 15); do
    curl -s "http://127.0.0.1:${SIGNAL_PORT:-8402}/health" | grep -q '"ok":true' && break
    sleep 2
  done
  curl -s "http://127.0.0.1:${SIGNAL_PORT:-8402}/health" | grep -q '"ok":true' \
    && echo "   oracle healthy" || { echo "   ORACLE FAILED — see $LOG_DIR/oracle.log"; exit 1; }

  echo "── supervised swarm (EPOCH_HOURS=${EPOCH_HOURS:-4}, TICK_MINUTES=${TICK_MINUTES:-60})"
  (cd "$AGENT" && nohup bash src/chains/celo/run-swarm-supervised.sh >> "$LOG_DIR/swarm.log" 2>&1 &)
  sleep 3
  status
  echo ""
  echo "logs: $LOG_DIR/{swarm,oracle}.log · dashboard: https://spawn-celo-swarm.vercel.app"
}

stop() {
  if [ "${1:-}" = "--unwind" ]; then
    echo "── KILL SWITCH: unwinding all agents to the treasury first"
    for p in $(super_pids); do kill -9 "$p" 2>/dev/null || true; done  # don't let it relaunch
    pkill -INT -f "src/chains/celo/swarm-start.ts" || true
    echo "   waiting for unwind to finish (watch: tail -f $LOG_DIR/swarm.log)…"
    while pgrep -f "src/chains/celo/swarm-start.ts" >/dev/null; do sleep 5; done
    echo "   unwind complete — funds back at the treasury"
    for p in $(oracle_pids); do kill -9 "$p" 2>/dev/null || true; done
  else
    echo "── stopping stack (positions stay deployed; './run-celo.sh start' resumes safely)"
    kill_all
  fi
  pkill -x caffeinate 2>/dev/null || true
  echo "stopped."
}

status() {
  echo "── status"
  [ -n "$(super_pids)" ]  && echo "   supervisor:   RUNNING" || echo "   supervisor:   stopped"
  [ -n "$(swarm_pids)" ]  && echo "   swarm:        RUNNING" || echo "   swarm:        stopped"
  [ -n "$(oracle_pids)" ] && echo "   oracle:       RUNNING" || echo "   oracle:       stopped"
  pgrep -x caffeinate >/dev/null && echo "   sleep guard:  ON" || echo "   sleep guard:  off"
  if [ -f "$ROOT/celo_swarm_state.json" ]; then
    python3 - <<'PY'
import json
s = json.load(open("celo_swarm_state.json"))
active = [a for a in s["agents"] if a["status"] == "ACTIVE"]
retired = [a for a in s["agents"] if a["status"] == "RETIRED"]
gens = max(a["generation"] for a in s["agents"])
print(f"   epoch:        #{s['epochNumber']} (started {s.get('epochStartedAt', '—')})")
print(f"   agents:       {len(active)} active / {len(retired)} retired / max gen g{gens}")
PY
  fi
}

case "${1:-start}" in
  start)  start ;;
  stop)   stop "${2:-}" ;;
  status) status ;;
  logs)   tail -n 40 -f "$LOG_DIR/swarm.log" "$LOG_DIR/oracle.log" ;;
  *) echo "usage: $0 {start|stop [--unwind]|status|logs}"; exit 1 ;;
esac
