#!/usr/bin/env bash
# N (PERF_RUNS, по умолчанию 10) прогонов measure.spec.ts на одном стеке → build/artifacts/CL-10/{perf-runs.csv,summary.txt}.
set -uo pipefail
source "$(dirname "$0")/stack.sh"
trap perf_down EXIT
OUT=build/artifacts/CL-10
N="${PERF_RUNS:-10}"
mkdir -p "$OUT" && echo "run,metric,value" >"$OUT/perf-runs.csv"
perf_up || exit 1
for i in $(seq 1 "$N"); do
  timeout "${PERF_TIMEOUT:-540}" pnpm --filter @planar/e2e exec playwright test -c web/perf/playwright.config.ts \
    >"$OUT/run-$i.log" 2>&1 || echo "прогон $i: код $?" >&2
  grep -E '^[a-z_0-9]+=[0-9.]+$' "$OUT/run-$i.log" | sed -E "s/^(.*)=(.*)$/$i,\1,\2/" >>"$OUT/perf-runs.csv"
done
python3 - "$OUT" <<'PY'
import csv, sys, statistics as st, collections
d = collections.defaultdict(list); runs = set()
for r in csv.DictReader(open(sys.argv[1] + "/perf-runs.csv")):
    d[r["metric"]].append(float(r["value"])); runs.add(r["run"])
with open(sys.argv[1] + "/summary.txt", "w") as f:
    f.write(f"runs={len(runs)}\n")
    for m, v in d.items():
        f.write(f"{m}_median={st.median(v):.1f} {m}_min={min(v):.1f} {m}_max={max(v):.1f}\n")
PY
