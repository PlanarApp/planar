#!/usr/bin/env bash
# Пересборка web с sourcemap и перезапуск vite preview (стек api уже поднят up.sh).
set -uo pipefail
cd "$(dirname "$0")/../../../.."
. e2e/web/perf/profile/env.sh
[ -f /tmp/wb17-preview.pid ] && kill -- "-$(cat /tmp/wb17-preview.pid)" 2>/dev/null
cd apps/web
node_modules/.bin/vite build --sourcemap >../../build/wb17-build.log 2>&1 || { tail -20 ../../build/wb17-build.log; exit 1; }
API_PROXY_TARGET="http://localhost:$API_PORT" setsid node_modules/.bin/vite preview --port "$WEB_PORT" --strictPort >../../build/wb17-preview.log 2>&1 </dev/null &
echo $! >/tmp/wb17-preview.pid
for _ in $(seq 1 30); do curl -sf "http://localhost:$WEB_PORT/api/health" >/dev/null && exit 0; sleep 1; done
exit 1
