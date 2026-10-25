#!/usr/bin/env bash
# Восстановление planar из архива backup.sh на чистый стек (C-ops-backup v1).
# Использование: ops/restore.sh [--force] <архив>   (--force — даже если в базе есть пользователи)
set -euo pipefail
here="$(dirname "$0")"

force=""
[ "${1:-}" = --force ] && { force=1; shift; }
arc="$(readlink -f -- "${1:-}" 2>/dev/null || true)"  # до cd: путь относительно текущего каталога
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
  # сбой запроса — ошибка, а не «пустая база»; 0 только если базы или таблицы users нет
  users=0
  have="$(dc exec -T postgres psql -U postgres -d postgres -Atc "select 1 from pg_database where datname='planar'")" || die "не удалось проверить базу"
  if [ -n "$have" ]; then
    tbl="$(pgq "select to_regclass('public.users') is not null")" || die "не удалось проверить таблицу users"
    [ "$tbl" = t ] && { users="$(pgq "select count(*) from users where password_hash <> '!'")" || die "не удалось посчитать пользователей"; }
  fi
  [ "$users" = 0 ] || die "в базе уже есть пользователи ($users); --force для перезаписи"
fi

dc stop api
# чистая база: api уже накатил миграции и pg-boss, pg_restore --clean на них падает
dc exec -T postgres psql -U postgres -d postgres -qc 'drop database if exists planar with (force)' -c 'create database planar'
dc exec -T postgres pg_restore -U postgres -d planar --clean --if-exists --no-owner <"$work/db.dump"
dc run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/files && tar -C /data -xf -' <"$work/files.tar"
dc up -d api

wait_ready 120 || die "api не стал готов после восстановления"
echo "restore: OK ($arc)"
