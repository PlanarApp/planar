#!/usr/bin/env bash
# Замер бюджетов §7 на прод-сборке web (vite preview) против dev-стека api/postgres.
set -uo pipefail
source "$(dirname "$0")/stack.sh"
trap perf_down EXIT
perf_up || exit 1
timeout "${PERF_TIMEOUT:-540}" pnpm --filter @planar/e2e exec playwright test -c web/perf/playwright.config.ts
