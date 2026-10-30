#!/usr/bin/env bash
# bash bench.sh <label> — rebuild + measurements mutate/cold/warm/switch/realtime into build/artifacts/WB-17/results/<label>/ (call under cpu lock)
cd "$(dirname "$0")/../../../.."
export LABEL=${1:?label}
bash e2e/web/perf/profile/rebuild.sh || exit 1
bash e2e/web/perf/profile/runall.sh mutate stages
