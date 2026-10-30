#!/usr/bin/env bash
# Usage: ops/export-public.sh <dest-dir>
# Copies the tracked tree (git ls-files) minus ops/export-exclude.txt into <dest-dir>, a git repo,
# and makes one commit (initial, or the next one on top of an existing repo). Never pushes.
# Exclude entries: "dir/" = prefix, otherwise a path or a glob (* matches any chars, incl. '/').
set -euo pipefail
dest="${1:?usage: export-public.sh <dest-dir>}"
root="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
cd "$root"
mapfile -t pats < <(grep -v '^[[:space:]]*\(#\|$\)' ops/export-exclude.txt)

excluded() {
  local p=$1 x
  for x in "${pats[@]}"; do
    case $x in
      */) [[ $p == "$x"* ]] && return 0 ;;
      *) [[ $p == $x ]] && return 0 ;;
    esac
  done
  return 1
}

mkdir -p "$dest"
[ -d "$dest/.git" ] || git -C "$dest" init -q
# fail before touching anything if dest already holds an excluded path
bad=0
while IFS= read -r -d '' p; do
  excluded "$p" && { echo "excluded path present in dest: $p" >&2; bad=1; }
done < <(git -C "$dest" ls-files -z --cached --others --exclude-standard)
[ "$bad" = 0 ] || exit 1

# sync: drop tracked files in dest, then copy the filtered list
git -C "$dest" ls-files -z | (cd "$dest" && xargs -0 -r rm -f --)
git ls-files -z | while IFS= read -r -d '' p; do
  excluded "$p" && continue
  [ -e "$p" ] || continue
  mkdir -p "$dest/$(dirname "$p")"
  cp -P -- "$p" "$dest/$p"
done
git -C "$dest" add -A
git -C "$dest" -c user.name="${GIT_AUTHOR_NAME:-planar-export}" -c user.email="${GIT_AUTHOR_EMAIL:-export@localhost}" \
  commit -q --allow-empty -m "Export from private repo $(git rev-parse --short HEAD)"
echo "exported to $dest"
