#!/usr/bin/env bash
# Restore planar from a backup.sh archive onto a clean stack (C-ops-backup v1).
# Usage: ops/restore.sh [--force] <archive>   (--force — even if the database has users)
set -euo pipefail
here="$(dirname "$0")"

force=""
[ "${1:-}" = --force ] && { force=1; shift; }
arc="$(readlink -f -- "${1:-}" 2>/dev/null || true)"  # before cd: a path relative to the current directory
cd "$here/.."
. ops/lib.sh
[ -f "$arc" ] || die "usage: restore.sh [--force] <архив>"

dc up -d postgres
for _ in $(seq 1 60); do dc exec -T postgres pg_isready -U postgres -d planar -h localhost >/dev/null 2>&1 && break; sleep 2; done
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tar -xf "$arc" -C "$work" || die "архив не читается"
verify_dir "$work"

img="$(dc run --rm --no-deps -T --entrypoint sh api -c "grep -o '\"idx\"' /app/drizzle/meta/_journal.json | wc -l")"
[ "$(mtop "$work/manifest.json" migrations)" -le "$img" ] || die "архив новее кода: миграций в архиве $(mtop "$work/manifest.json" migrations) > $img в образе"
if [ -z "$force" ]; then
  # a request failure is an error, not an «empty database»; 0 only if there is no database or no users table
  users=0
  have="$(dc exec -T postgres psql -U postgres -d postgres -Atc "select 1 from pg_database where datname='planar'")" || die "не удалось проверить базу"
  if [ -n "$have" ]; then
    tbl="$(pgq "select to_regclass('public.users') is not null")" || die "не удалось проверить таблицу users"
    [ "$tbl" = t ] && { users="$(pgq "select count(*) from users where password_hash <> '!'")" || die "не удалось посчитать пользователей"; }
  fi
  [ "$users" = 0 ] || die "в базе уже есть пользователи ($users); --force для перезаписи"
fi

dc stop api
# clean database: api has already applied migrations and pg-boss, pg_restore --clean fails on them
dc exec -T postgres psql -U postgres -d postgres -qc 'drop database if exists planar with (force)' -c 'create database planar'
dc exec -T postgres pg_restore -U postgres -d planar --clean --if-exists --no-owner <"$work/db.dump"
dc run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/files && tar -C /data -xf -' <"$work/files.tar"
dc up -d api

wait_ready 120 || die "api не стал готов после восстановления"
echo "restore: OK ($arc)"
