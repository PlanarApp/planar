# Общий код run.sh/repeat.sh: подъём стека (dev api/postgres + прод-сборка web через vite preview) и остановка.
# Источник: `source stack.sh` из скрипта; после perf_up доступны E2E_BASE_URL, cwd — корень репозитория.
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
export COMPOSE_PROJECT_NAME=planar-e2e-wb15 API_PORT=3215 WEB_PORT=5315 DEV_PG_PORT=55515
PREVIEW_PID=
perf_down() {
  [ -n "$PREVIEW_PID" ] && kill -- "-$PREVIEW_PID" 2>/dev/null
  docker compose -f compose.dev.yml down -v >/dev/null 2>&1
}
wait_health() { # $1 — порт
  for _ in $(seq 1 90); do curl -sf "http://localhost:$1/api/health" >/dev/null && return 0; sleep 2; done
  echo "api не отвечает на :$1" >&2
  return 1
}
perf_up() {
  mkdir -p build
  ./dev.sh reset || return 1
  wait_health "$API_PORT" || return 1
  ./dev.sh seed --tasks 10000 ${PERF_SEED_DATES:+--dates} || return 1
  if [ -n "${PERF_MODULES:-}" ]; then # модули collab: PERF_MODULES=docs,chat
    E2E_BASE_URL="http://localhost:$WEB_PORT" pnpm --filter @planar/e2e exec tsx web/perf/modules.ts "$PERF_MODULES" || return 1
  fi
  docker compose -f compose.dev.yml stop web || return 1
  pnpm --filter @planar/web build || return 1
  cd apps/web
  API_PROXY_TARGET="http://localhost:$API_PORT" setsid node_modules/.bin/vite preview --port "$WEB_PORT" --strictPort \
    >../../build/wb15-preview.log 2>&1 </dev/null &
  PREVIEW_PID=$! # setsid-лидер группы; bin — сам node, без обёртки pnpm (иначе потомок уходит в свою группу)
  cd ../..
  wait_health "$WEB_PORT" || return 1
  export E2E_BASE_URL="http://localhost:$WEB_PORT"
}
