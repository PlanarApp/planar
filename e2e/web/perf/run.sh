#!/usr/bin/env bash
# Measurement of §7 budgets on the prod build of web (vite preview) against the dev stack api/postgres.
set -uo pipefail
source "$(dirname "$0")/stack.sh"
trap perf_down EXIT
perf_up || exit 1
timeout "${PERF_TIMEOUT:-540}" pnpm --filter @planar/e2e exec playwright test -c web/perf/playwright.config.ts
