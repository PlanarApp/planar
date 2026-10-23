#!/usr/bin/env bash
# bash bench.sh <label> — пересборка + замеры mutate/cold/warm/switch/realtime в build/artifacts/WB-17/results/<label>/ (вызывать под lock cpu)
cd "$(dirname "$0")/../../../.."
export LABEL=${1:?label}
bash e2e/web/perf/profile/rebuild.sh || exit 1
bash e2e/web/perf/profile/runall.sh mutate stages
