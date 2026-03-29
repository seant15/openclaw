#!/usr/bin/env bash
set -e

# Starts the Context Audit Hook server in the background.
# Designed to be invoked via OPENCLAW_DOCKER_INIT_SCRIPT.

WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-/data/workspace}"
STATE_DIR="$WORKSPACE_DIR/security/state"
mkdir -p "$STATE_DIR"

echo "[security-hooks] starting context hook server..."
chmod +x /app/scripts/context-hook-server.js 2>/dev/null || true

# Run in background; log to state dir
node /app/scripts/context-hook-server.js >> "$STATE_DIR/context-hook.log" 2>&1 &
echo $! > "$STATE_DIR/context-hook.pid"

echo "[security-hooks] context hook server started (pid=$(cat "$STATE_DIR/context-hook.pid"))"
