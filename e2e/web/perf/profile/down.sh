#!/usr/bin/env bash
cd "$(dirname "$0")/../../../.."
. e2e/web/perf/profile/env.sh
[ -f /tmp/wb17-preview.pid ] && kill -- "-$(cat /tmp/wb17-preview.pid)" 2>/dev/null
docker compose -f compose.dev.yml down -v
