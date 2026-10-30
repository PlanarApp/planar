#!/usr/bin/env bash
# e2e collab (chat and documents) against the dev stack; Playwright result — in stdout.
set -uo pipefail
cd "$(dirname "$0")/../.."
export COMPOSE_PROJECT_NAME=planar-e2e-cl5 API_PORT=3225 WEB_PORT=5325 DEV_PG_PORT=55525
cleanup() { docker compose -f compose.dev.yml down -v >/dev/null 2>&1; }
trap cleanup EXIT
./dev.sh reset || exit 1
for _ in $(seq 1 90); do curl -sf "http://localhost:$WEB_PORT/api/health" >/dev/null && break; sleep 2; done
curl -sf "http://localhost:$WEB_PORT/api/health" >/dev/null || { echo "стек не поднялся" >&2; exit 1; }
./dev.sh seed || exit 1
E2E_BASE_URL="http://localhost:$WEB_PORT" timeout 540 pnpm --filter @planar/e2e exec playwright test -c web/playwright.config.ts collab.spec.ts
