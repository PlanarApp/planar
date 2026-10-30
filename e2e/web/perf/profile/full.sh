#!/usr/bin/env bash
# bash full.sh <label> — rebuild, measurements (mutate+stages), then CPU profiles with breakdown by source files (under cpu lock)
cd "$(dirname "$0")/../../../.."
export LABEL=${1:?label}
bash e2e/web/perf/profile/rebuild.sh || exit 1
bash e2e/web/perf/profile/runall.sh mutate stages idb-micro
PROF=1 bash e2e/web/perf/profile/runall.sh mutate stages
for n in mutate cold warm switch realtime; do
  node e2e/web/perf/profile/analyze.mjs build/wb17-raw/$LABEL/$n.cpuprofile > build/artifacts/WB-17/results/$LABEL/cpu-$n.json
done
