#!/usr/bin/env bash
# Замер бюджетов §7 на прод-сборке web (vite preview) против dev-стека api/postgres.
set -uo pipefail
cd "$(dirname "$0")/../../.."
export COMPOSE_PROJECT_NAME=planar-e2e-wb15 API_PORT=3215 WEB_PORT=5315 DEV_PG_PORT=55515
PREVIEW_PID=
cleanup() {
  [ -n "$PREVIEW_PID" ] && kill -- "-$PREVIEW_PID" 2>/dev/null
  docker compose -f compose.dev.yml down -v >/dev/null 2>&1
}
trap cleanup EXIT
wait_health() { # $1 — порт
  for _ in $(seq 1 90); do curl -sf "http://localhost:$1/api/health" >/dev/null && return 0; sleep 2; done
  echo "api не отвечает на :$1" >&2
  return 1
}
mkdir -p build
./dev.sh reset || exit 1
wait_health "$API_PORT" || exit 1
./dev.sh seed --tasks 10000 || exit 1
docker compose -f compose.dev.yml stop web || exit 1
pnpm --filter @planar/web build || exit 1
cd apps/web
API_PROXY_TARGET="http://localhost:$API_PORT" setsid node_modules/.bin/vite preview --port "$WEB_PORT" --strictPort \
  >../../build/wb15-preview.log 2>&1 </dev/null &
PREVIEW_PID=$! # setsid-лидер группы; bin — сам node, без обёртки pnpm (иначе потомок уходит в свою группу)
cd ../..
wait_health "$WEB_PORT" || exit 1
E2E_BASE_URL="http://localhost:$WEB_PORT" timeout 540 pnpm --filter @planar/e2e exec playwright test -c web/perf/playwright.config.ts
