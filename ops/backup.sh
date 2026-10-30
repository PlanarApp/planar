#!/usr/bin/env bash
# Backup of planar per C-ops-backup v1: $BACKUP_DIR/planar-<UTC>.tar (db.dump + files.tar + manifest.json).
# Usage: ops/backup.sh [--deep] | ops/backup.sh --rotate-only
# Rotation: PLANAR_NOW (ISO UTC) overrides «now» — for tests.
# Schedule: cron — `0 3 * * * cd /opt/planar && ./ops/backup.sh >>backups/backup.log 2>&1`;
#   systemd — ops/systemd/planar-backup.{service,timer}.
set -euo pipefail
cd "$(dirname "$0")/.."
. ops/lib.sh
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

# Keeps the newest archive of each of the last 7 days and of each of the last 4 ISO weeks (UTC).
# $1 — the archive that is never deleted.
rotate() {
  local now="${PLANAR_NOW:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}" i f b day wk
  declare -A days=() weeks=() sd=() sw=() keep=()
  for i in 0 1 2 3 4 5 6; do days[$(date -u -d "$now - $i days" +%Y%m%d)]=1; done
  for i in 0 1 2 3; do weeks[$(date -u -d "$now - $((i * 7)) days" +%G-%V)]=1; done
  [ -n "${1:-}" ] && keep[$(basename "$1")]=1
  # names are sorted chronologically; newest first
  while IFS= read -r f; do
    b="$(basename "$f")"; day="${b:7:8}"; wk="$(date -u -d "$day" +%G-%V)"
    if [ -n "${days[$day]:-}" ] && [ -z "${sd[$day]:-}" ]; then sd[$day]=1; keep[$b]=1; fi
    if [ -n "${weeks[$wk]:-}" ] && [ -z "${sw[$wk]:-}" ]; then sw[$wk]=1; keep[$b]=1; fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'planar-????????T??????Z.tar' | sort -r)
  while IFS= read -r f; do
    [ -n "${keep[$(basename "$f")]:-}" ] || rm -f -- "$f"
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'planar-????????T??????Z.tar')
}

deep=""
case "${1:-}" in
  --rotate-only) rotate; exit 0 ;;
  --deep) deep=deep ;;
  "") ;;
  *) die "usage: backup.sh [--deep|--rotate-only]" ;;
esac

ts="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/planar-$ts.tar"
work="$(mktemp -d "$BACKUP_DIR/.work.XXXXXX")"
trap 'rm -rf "$work" "$out.partial"' EXIT

migrations="$(pgq 'select count(*) from drizzle.__drizzle_migrations')"
dc exec -T postgres pg_dump -U postgres -Fc planar >"$work/db.dump"
# the DB is dumped before the files: files are addressed by content, extra ones are harmless
dc exec -T api sh -c 'mkdir -p /data/files && tar -C /data -cf - files' >"$work/files.tar"
count="$(tar -tf "$work/files.tar" | grep -vc '/$' || true)"
cat >"$work/manifest.json" <<JSON
{
  "format": "planar-backup",
  "version": 1,
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "migrations": $migrations,
  "db": {"file": "db.dump", "sha256": "$(sha256sum "$work/db.dump" | cut -d' ' -f1)"},
  "files": {"file": "files.tar", "sha256": "$(sha256sum "$work/files.tar" | cut -d' ' -f1)", "count": $count}
}
JSON
tar -cf "$out.partial" -C "$work" manifest.json db.dump files.tar
verify_archive "$out.partial" "$deep"
mv "$out.partial" "$out"
rotate "$out"
echo "$out"
