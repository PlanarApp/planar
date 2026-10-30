#!/usr/bin/env bash
# Starts the WB-17 stack (api+postgres, seed 10000), builds web ($1=sourcemap|plain) and runs vite preview. Does not stop — see down.sh.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
. e2e/web/perf/profile/env.sh
MODE=${1:-sourcemap}
wait_health() { for _ in $(seq 1 90); do curl -sf "http://localhost:$1/api/health" >/dev/null && return 0; sleep 2; done; echo "нет :$1" >&2; return 1; }
mkdir -p build
if ! curl -sf "http://localhost:$API_PORT/api/health" >/dev/null; then
  ./dev.sh reset || exit 1
  wait_health "$API_PORT" || exit 1
  ./dev.sh seed --tasks 10000 || exit 1
  docker compose -f compose.dev.yml stop web || exit 1
fi
[ -f /tmp/wb17-preview.pid ] && kill -- "-$(cat /tmp/wb17-preview.pid)" 2>/dev/null
cd apps/web
if [ "$MODE" = sourcemap ]; then node_modules/.bin/vite build --sourcemap || exit 1; else node_modules/.bin/vite build || exit 1; fi
API_PROXY_TARGET="http://localhost:$API_PORT" setsid node_modules/.bin/vite preview --port "$WEB_PORT" --strictPort \
  >../../build/wb17-preview.log 2>&1 </dev/null &
echo $! >/tmp/wb17-preview.pid
cd ../..
wait_health "$WEB_PORT"
