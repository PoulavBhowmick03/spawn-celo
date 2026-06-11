#!/usr/bin/env bash
# Fly.io startup for the Celo Hedge Swarm.
#
# Source code is baked into the image at /app.
# This script:
#   1. Sets up git (for publishDocs epoch pushes)
#   2. Restores latest state files from GitHub (so restart = resume, not reset)
#   3. Starts the x402 signal oracle on $PORT (Fly health-check target)
#   4. Hands off to the crash-restart swarm supervisor

PORT="${PORT:-8080}"
cd /app

# ── 1. git setup ────────────────────────────────────────────────────────────
echo "[fly-start] initialising git…"
git init -b main 2>/dev/null || true
git config user.name  "spawn-orchestrator"
git config user.email "orchestrator@spawn.local"

if [ -n "${GITHUB_PAT:-}" ]; then
  AUTH_REPO="https://${GITHUB_PAT}@github.com/PoulavBhowmick03/spawn-celo.git"
  git remote add spawn-celo "$AUTH_REPO" 2>/dev/null \
    || git remote set-url spawn-celo "$AUTH_REPO"

  echo "[fly-start] fetching latest state from GitHub…"
  if git fetch spawn-celo main --depth=1 --quiet 2>/dev/null; then
    # Pull only state files — leave source tree from the image intact
    git checkout spawn-celo/main -- \
      celo_activity.jsonl celo_swarm_state.json docs/ 2>/dev/null || true
    # Set HEAD to the remote tip so publishDocs pushes are fast-forward
    git reset --mixed spawn-celo/main 2>/dev/null \
      || git commit --allow-empty -q -m "init: container start" 2>/dev/null || true
    echo "[fly-start] state restored ($(git rev-parse --short HEAD 2>/dev/null || echo '?'))"
  else
    echo "[fly-start] WARNING: GitHub fetch failed — starting from image state"
    git commit --allow-empty -q -m "init: container start (no remote state)" 2>/dev/null || true
  fi
else
  echo "[fly-start] WARNING: GITHUB_PAT not set — publishDocs git-push will fail (swarm still runs)"
  git commit --allow-empty -q -m "init: container start" 2>/dev/null || true
fi

# ── 2. link pre-installed node_modules ─────────────────────────────────────
echo "[fly-start] linking node_modules…"
ln -sf /deps/node_modules /app/agent/node_modules

# ── 3. signal oracle on $PORT (Fly health check) ───────────────────────────
echo "[fly-start] starting signal oracle on :${PORT}…"
cd /app/agent
SIGNAL_PORT="${PORT}" SIGNAL_URL="http://127.0.0.1:${PORT}/signal" \
  ./node_modules/.bin/tsx src/chains/celo/signal-service.ts &

echo "[fly-start] waiting for oracle…"
for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:${PORT}/health" 2>/dev/null | grep -q '"ok":true' && break
  sleep 3
done
if curl -sf "http://127.0.0.1:${PORT}/health" 2>/dev/null | grep -q '"ok":true'; then
  echo "[fly-start] oracle healthy on :${PORT}"
else
  echo "[fly-start] WARNING: oracle not responding after 60s — swarm will still start"
fi

# ── 4. supervised swarm (crash-restart; stops on kill-switch exit 0) ────────
echo "[fly-start] starting supervised swarm…"
exec bash /app/agent/src/chains/celo/run-swarm-supervised.sh
