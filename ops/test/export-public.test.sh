#!/usr/bin/env bash
# Test of ops/export-public.sh on a temporary copy of the tracked tree. No docker, no network.
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# source repo: working-tree copy of tracked files plus excluded probes
mkdir "$T/src"
(cd "$here" && git ls-files -z -co --exclude-standard | while IFS= read -r -d '' p; do [ -e "$p" ] && printf '%s\0' "$p"; done | tar --null -cf - -T -) | tar -xf - -C "$T/src"
cd "$T/src"
mkdir -p docs/plan .dpcli e2e data build
for f in docs/plan/x.md .dpcli/y CLAUDE.md dpcli.yml e2e/_probe.mjs data/d build/b; do echo x >"$f"; done
git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -q -m src

./ops/export-public.sh "$T/pub" >/dev/null
for f in docs/plan/x.md .dpcli/y CLAUDE.md dpcli.yml e2e/_probe.mjs data/d build/b; do
  [ ! -e "$T/pub/$f" ] || fail "excluded path exported: $f"
done
[ -f "$T/pub/ops/export-public.sh" ] || fail "kept file missing"
[ "$(git -C "$T/pub" rev-list --count HEAD)" = 1 ] || fail "expected 1 commit"

./ops/export-public.sh "$T/pub" >/dev/null
[ "$(git -C "$T/pub" rev-list --count HEAD)" = 2 ] || fail "second run must add a commit on top"

mkdir -p "$T/pub/docs/plan" && echo x >"$T/pub/docs/plan/leak.md"
if ./ops/export-public.sh "$T/pub" >/dev/null 2>&1; then fail "must exit non-zero when excluded path is in dest"; fi
echo "export-public: ok"
