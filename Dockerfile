# Spawn Protocol — Mantle agent swarm (parent.ts + control server)
# Long-running, single-instance Node service for Fly.io.
#
# The parent process forks child agents in-process and runs an HTTP control
# server (control-server.ts) on $PORT. It writes swarm state one level above
# its working dir, so the agent must live at /app/agent with /app as the
# repo root the control server reads back from.
FROM node:22-slim

# tini gives us a proper PID 1 so SIGTERM reaches the parent cleanly and it
# can forward shutdown to its forked children.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/agent

# Install deps first for layer caching. tsx is a devDependency but is required
# at runtime (the parent runs via `tsx src/parent.ts`), so install the full
# dependency set — do NOT use --omit=dev.
COPY agent/package.json ./
RUN npm install --no-audit --no-fund

# Application source. Config (RPC, addresses, live flags, keys) is injected by
# Fly via [env] and `fly secrets set` — .env is intentionally not copied.
COPY agent/ ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]
# `npm run parent` runs from /app/agent, which keeps the control server's
# state path (cwd/../) aligned with where parent.ts writes swarm_state.json.
CMD ["npm", "run", "parent"]
