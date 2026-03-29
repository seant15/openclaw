#!/usr/bin/env bash
set -euo pipefail

# Trigger the context audit hook server.
PORT="${SEC_CONTEXT_AUDIT_HOOK_PORT:-33123}"
URL="http://127.0.0.1:${PORT}/context-audit"

# best-effort curl (present in base image)
if command -v curl >/dev/null 2>&1; then
  curl -sS -X POST "$URL" -H 'content-type: application/json' -d '{}' || true
else
  # fallback: busybox wget
  wget -qO- --post-data='{}' --header='content-type: application/json' "$URL" || true
fi
