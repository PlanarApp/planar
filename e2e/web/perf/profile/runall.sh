#!/usr/bin/env bash
# Все сценарии профилирования: bash runall.sh [PROF=1] — под замком cpu; результаты в build/artifacts/WB-17/results/, сырые профили в build/wb17-raw
cd "$(dirname "$0")/../../../.."
. e2e/web/perf/profile/env.sh
export E2E_BASE_URL=http://localhost:$WEB_PORT
pnpm --filter @planar/e2e exec playwright test -c web/perf/profile/playwright.config.ts "$@" 2>&1 | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | grep -E "^(cold|warm|switch|realtime|mutate|idb-micro) |passed|failed|Error|PAGEERROR|CONSOLE" 
