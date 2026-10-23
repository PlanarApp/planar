#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

DEV=(docker compose -f compose.dev.yml)

testdb() {
  if [ "$(docker inspect -f '{{.State.Running}}' planar-testdb 2>/dev/null || true)" = true ]; then
    :
  elif docker inspect planar-testdb >/dev/null 2>&1; then
    docker start planar-testdb >/dev/null
  else
    # параллельные копии делят один контейнер; гонка двух create — второй получит ошибку и просто стартует/ждёт
    docker run -d --name planar-testdb -p 55432:5432 -e POSTGRES_PASSWORD=postgres \
      pgvector/pgvector:pg18 >/dev/null 2>&1 || docker start planar-testdb >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 60); do
    docker exec planar-testdb pg_isready -U postgres -h localhost >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "planar-testdb не поднялся" >&2
  return 1
}

cmd="${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
  up) "${DEV[@]}" up -d --build ;;
  down) "${DEV[@]}" down ;;
  reset) "${DEV[@]}" down -v && "${DEV[@]}" up -d --build ;;
  seed) "${DEV[@]}" exec -T api pnpm --filter @planar/api seed "$@" ;;
  logs) "${DEV[@]}" logs -f "$@" ;;
  e2e) E2E_BASE_URL="http://localhost:${WEB_PORT:-5173}" pnpm --filter @planar/e2e test "$@" ;;
  measure) E2E_BASE_URL="http://localhost:${WEB_PORT:-5173}" pnpm --filter @planar/e2e measure "$@" ;;
  testdb) testdb ;;
  test) testdb && pnpm test "$@" ;;
  *) echo "usage: ./dev.sh up|down|reset|seed|logs|e2e|measure|test|testdb" >&2; exit 2 ;;
esac
