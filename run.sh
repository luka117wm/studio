#!/usr/bin/env bash
set -euo pipefail
trap 'kill 0' EXIT INT TERM
uv run uvicorn backend.app.main:app --reload --port 8000 2>&1 | sed 's/^/[api] /' &
pnpm -C frontend dev 2>&1 | sed 's/^/[web] /' &
wait
