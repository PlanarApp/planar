#!/usr/bin/env bash
# Demo stand reset per C-launch-demo v1: clears the application tables and reseeds the English demo data (dates from «today»).
# Usage: ops/demo-reset.sh   (exit 0 / 1). Never run on a real installation: all data is wiped.
# Schedule: systemd — ops/systemd/planar-demo-reset.{service,timer}; cron — `0 4 * * * cd /opt/planar && ./ops/demo-reset.sh >>backups/demo-reset.log 2>&1`.
# The image has no tsx/pnpm and ships only the build, so the compiled seed is run: dist/db/seed-demo.js (= `pnpm seed:demo`).
set -euo pipefail
cd "$(dirname "$0")/.."
. ops/lib.sh
dc exec -T api node dist/db/seed-demo.js --reset || { echo "planar-demo-reset: seed:demo --reset failed" >&2; exit 1; }
echo "planar-demo-reset: ok $(date -u +%Y-%m-%dT%H:%M:%SZ)"
