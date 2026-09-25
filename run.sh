#!/usr/bin/env bash
set -euo pipefail
trap 'kill 0' EXIT INT TERM
# --timeout-graceful-shutdown: открытый поток SSE иначе вешает Ctrl+C и --reload (docs/jobs.md)
uv run uvicorn app.main:app --app-dir backend --reload --port 8000 --timeout-graceful-shutdown 3 2>&1 | sed -u 's/^/[api] /' &
pnpm -C frontend dev 2>&1 | sed -u 's/^/[web] /' &
wait
