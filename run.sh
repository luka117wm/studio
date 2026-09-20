#!/usr/bin/env bash
set -euo pipefail
trap 'kill 0' EXIT INT TERM
uv run uvicorn app.main:app --app-dir backend --reload --port 8000 2>&1 | sed 's/^/[api] /' &
pnpm -C frontend dev 2>&1 | sed 's/^/[web] /' &
wait
