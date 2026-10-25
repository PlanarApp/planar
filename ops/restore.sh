#!/usr/bin/env bash
# Восстановление planar из архива backup.sh на чистый стек (C-ops-backup v1).
# Использование: ops/restore.sh [--force] <архив>   (--force — даже если в базе есть пользователи)
set -euo pipefail
cd "$(dirname "$0")/.."
. ops/lib.sh
force=""
[ "${1:-}" = --force ] && { force=1; shift; }
arc="${1:-}"
[ -f "$arc" ] || die "usage: restore.sh [--force] <архив>"

dc up -d postgres
for _ in $(seq 1 60); do dc exec -T postgres pg_isready -U postgres -d planar -h localhost >/dev/null 2>&1 && break; sleep 2; done
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tar -xf "$arc" -C "$work" || die "архив не читается"
verify_dir "$work"

img="$(dc run --rm --no-deps -T --entrypoint sh api -c "grep -o '\"idx\"' /app/drizzle/meta/_journal.json | wc -l")"
[ "$(mtop "$work/manifest.json" migrations)" -le "$img" ] || die "архив новее кода: миграций в архиве $(mtop "$work/manifest.json" migrations) > $img в образе"
users="$(pgq "select count(*) from users where password_hash <> '!'" 2>/dev/null || echo 0)"
[ "$users" = 0 ] || [ -n "$force" ] || die "в базе уже есть пользователи ($users); --force для перезаписи"

dc stop api
# чистая база: api уже накатил миграции и pg-boss, pg_restore --clean на них падает
dc exec -T postgres psql -U postgres -d postgres -qc 'drop database if exists planar with (force)' -c 'create database planar'
dc exec -T postgres pg_restore -U postgres -d planar --clean --if-exists --no-owner <"$work/db.dump"
dc run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/files && tar -C /data -xf -' <"$work/files.tar"
dc up -d api

# ждём готовность прямо в api (порт хоста не нужен); /ready появился в OP-3, до него — /health
probe() { dc exec -T api node -e "fetch('http://localhost:3000/api/health$1').then(r=>process.exit(r.status==404?2:r.ok?0:1),()=>process.exit(1))"; }
for _ in $(seq 1 60); do
  rc=0; probe /ready >/dev/null 2>&1 || rc=$?
  [ $rc = 2 ] && { rc=0; probe "" >/dev/null 2>&1 || rc=$?; }
  [ $rc = 0 ] && { echo "restore: OK ($arc)"; exit 0; }
  sleep 2
done
die "api не стал готов после восстановления"
