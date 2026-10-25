# Общие функции backup.sh / restore.sh (source). Формат: docs/contracts/ops.md §C-ops-backup v1.
# shortcut: manifest разбирается grep/sed без jq — строки db/files в manifest.json пишет только backup.sh.

dc() { docker compose "$@"; }
die() { echo "planar-backup: $*" >&2; exit 1; }
# значение из строки манифеста: mval <файл> <ключ-блока> <поле>
mval() { grep "\"$2\"" "$1" | sed -n "s/.*\"$3\": *\"\{0,1\}\([^\",}]*\).*/\1/p" | head -1; }
mtop() { sed -n "s/^ *\"$2\": *\"\{0,1\}\([^\",}]*\).*/\1/p" "$1" | head -1; }
pgq() { dc exec -T postgres psql -U postgres -d planar -Atc "$1"; }

# Целостность распакованного архива в каталоге $1; $2=deep — имя файла = sha256 содержимого.
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
    mkdir -p "$d/x" && tar -xf "$d/files.tar" -C "$d/x"
    while IFS= read -r f; do
      [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$(basename "$f")" ] || die "файл не соответствует своему sha256: $f"
    done < <(find "$d/x" -type f)
    rm -rf "$d/x"
  fi
}

# Целостность файла-архива $1 (распаковка во временный каталог).
verify_archive() {
  local t; t="$(mktemp -d)"
  tar -xf "$1" -C "$t" || { rm -rf "$t"; die "архив не читается: $1"; }
  (verify_dir "$t" "${2:-}") || { rm -rf "$t"; exit 1; }
  rm -rf "$t"
}
