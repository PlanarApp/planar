# Shared functions of backup.sh / restore.sh (sourced). Format: docs/contracts/ops.md §C-ops-backup v1.
# shortcut: manifest is parsed with grep/sed without jq — only backup.sh writes the db/files lines to manifest.json, upgrade to jq if the format grows

dc() { docker compose "$@"; }
die() { echo "planar-backup: $*" >&2; exit 1; }
# value from a manifest line: mval <file> <block-key> <field>
mval() { grep "\"$2\"" "$1" | sed -n "s/.*\"$3\": *\"\{0,1\}\([^\",}]*\).*/\1/p" | head -1; }
mtop() { sed -n "s/^ *\"$2\": *\"\{0,1\}\([^\",}]*\).*/\1/p" "$1" | head -1; }
pgq() { dc exec -T postgres psql -U postgres -d planar -Atc "$1"; }

# Integrity of the unpacked archive in directory $1; $2=deep — file name = sha256 of the content.
verify_dir() {
  local d="$1" deep="${2:-}" m="$1/manifest.json" f got want n
  [ -f "$m" ] || die "нет manifest.json"
  [ "$(mtop "$m" format)" = planar-backup ] || die "неизвестный format"
  [ "$(mtop "$m" version)" = 1 ] || die "неизвестная версия архива: $(mtop "$m" version)"
  for f in db files; do
    want="$(mval "$m" "$f" sha256)"
    got="$(sha256sum "$d/$(mval "$m" "$f" file)" | cut -d' ' -f1)" || die "нет части $f"
    [ -n "$want" ] && [ "$got" = "$want" ] || die "sha256 части $f не совпадает с манифестом"
  done
  dc exec -T postgres pg_restore -l <"$d/db.dump" >/dev/null || die "pg_restore -l не прошёл"
  tar -tf "$d/files.tar" >/dev/null || die "tar -t не прошёл"
  n="$(tar -tf "$d/files.tar" | grep -vc '/$' || true)"
  [ "$n" = "$(mval "$m" files count)" ] || die "число файлов $n ≠ count манифеста"
  if [ "$deep" = deep ]; then
    mkdir -p "$d/x"
    tar -xf "$d/files.tar" -C "$d/x" || die "tar -x не прошёл"
    while IFS= read -r f; do
      [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$(basename "$f")" ] || die "файл не соответствует своему sha256: $f"
    done < <(find "$d/x" -type f)
    rm -rf "$d/x"
  fi
}

# Integrity of the archive file $1 (unpacked into a temporary directory).
verify_archive() {
  local t; t="$(mktemp -d)"
  tar -xf "$1" -C "$t" || { rm -rf "$t"; die "архив не читается: $1"; }
  (verify_dir "$t" "${2:-}") || { rm -rf "$t"; exit 1; }
  rm -rf "$t"
}

# Waits for api readiness from inside the container (not through Caddy: with PLANAR_DOMAIN port 80 gives a redirect). wait_ready <timeout_s>: 0 ready, 1 not ready.
wait_ready() {
  local end=$((SECONDS + ${1:?wait_ready <таймаут_с>}))
  while [ $SECONDS -lt $end ]; do
    dc exec -T api node -e "fetch('http://localhost:3000/api/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}
