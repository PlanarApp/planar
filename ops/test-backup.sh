#!/usr/bin/env bash
# Круг: стек → данные → бэкап → снос томов → restore → те же данные; ротация; повреждённый архив.
# Запуск: COMPOSE_PROJECT_NAME=planar-op2 HTTP_PORT=28080 HTTPS_PORT=28443 PLANAR_SUBNET=10.230.2.0/24 ./ops/test-backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-planar-backup-test}"
export HTTP_PORT="${HTTP_PORT:-28080}" HTTPS_PORT="${HTTPS_PORT:-28443}"
export PLANAR_SUBNET="${PLANAR_SUBNET:-10.230.2.0/24}" PLANAR_DOMAIN= POSTGRES_PASSWORD=smoke-pg-pass
export PUBLIC_URL="http://localhost:$HTTP_PORT" COOKIE_SECURE=false
export COMPOSE_FILE=compose.yml:deploy/compose.smoke.yml
TMP="$(mktemp -d)"
export BACKUP_DIR="$TMP/backups"
trap 'docker compose down -v --remove-orphans --rmi local >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
fail() { echo "backup-test: FAIL: $*" >&2; exit 1; }
URL="$PUBLIC_URL"

wait_health() {
  for _ in $(seq 1 90); do curl -sf "$URL/api/health" >/dev/null && return 0; sleep 2; done
  docker compose logs --tail 40 >&2; fail "стек не отвечает"
}
login() { curl -sf -c "$TMP/jar" -H "Origin: $URL" -H 'content-type: application/json' -d '{"login":"admin","password":"admin"}' "$URL/api/auth/login" >/dev/null; }
# снимок: число задач, sha256 файлов (по выдаче сервера), вход
snapshot() {
  login || fail "вход admin не работает"
  echo "tasks=$(docker compose exec -T postgres psql -U postgres -d planar -Atc 'select count(*) from tasks')"
  local s
  for s in $(cat "$TMP/shas"); do
    echo "file $s served=$(curl -sf -b "$TMP/jar" "$URL/files/$s" | sha256sum | cut -d' ' -f1)"
  done
}

docker compose up -d --build postgres api caddy
wait_health
pg="$(docker compose port postgres 5432)"
DATABASE_URL="postgres://postgres:$POSTGRES_PASSWORD@127.0.0.1:${pg##*:}/planar" pnpm --filter @planar/api seed --tasks 20 >/dev/null
login
: >"$TMP/shas"
for i in 1 2 3; do
  head -c $((i * 40000)) /dev/urandom >"$TMP/f$i"
  curl -sf -b "$TMP/jar" -H "Origin: $URL" -F "file=@$TMP/f$i" "$URL/files" >/dev/null || fail "загрузка файла $i"
  sha256sum "$TMP/f$i" | cut -d' ' -f1 >>"$TMP/shas"
done
snapshot >"$TMP/before"
grep -q '^tasks=[1-9]' "$TMP/before" || fail "нет задач в сиде"
[ "$(grep -c '^file ' "$TMP/before")" = 3 ] || fail "не все файлы выданы"
awk '/^file/ {split($3,a,"="); if (a[2]!=$2) exit 1}' "$TMP/before" || fail "sha256 выдачи не совпал"

arc="$(./ops/backup.sh --deep | tail -1)"
[ -f "$arc" ] || fail "архив не создан"
ls "$BACKUP_DIR"/*.partial >/dev/null 2>&1 && fail "остался .partial"

# повреждённый архив отвергается
mkdir "$TMP/bad" && tar -xf "$arc" -C "$TMP/bad" && printf x >>"$TMP/bad/db.dump"
tar -cf "$TMP/bad.tar" -C "$TMP/bad" manifest.json db.dump files.tar
if ./ops/restore.sh "$TMP/bad.tar" >/dev/null 2>&1; then fail "повреждённый архив принят"; fi

# --deep ловит сбой tar -x: files.tar читается (-t), но не распаковывается (файл a и a/b)
mkdir "$TMP/dp" && (cd "$TMP/dp" && echo 1 >a && echo 2 >b && tar -cf files.tar --transform 's,^b,a/b,' a b)
cp "$TMP/bad/manifest.json" "$TMP/dp/"; tar -xf "$arc" -C "$TMP/dp" db.dump
sed -i "s/\"sha256\": \"[0-9a-f]*\", \"count\": [0-9]*/\"sha256\": \"$(sha256sum "$TMP/dp/files.tar" | cut -d' ' -f1)\", \"count\": 2/;s/\"db\": {\"file\": \"db.dump\", \"sha256\": \"[0-9a-f]*/\"db\": {\"file\": \"db.dump\", \"sha256\": \"$(sha256sum "$TMP/dp/db.dump" | cut -d' ' -f1)/" "$TMP/dp/manifest.json"
tar -cf "$TMP/dp.tar" -C "$TMP/dp" manifest.json db.dump files.tar
bash -c '. ops/lib.sh; verify_archive "$1"' _ "$TMP/dp.tar" >/dev/null 2>&1 || fail "тест --deep: без deep архив должен пройти"
if bash -c '. ops/lib.sh; verify_archive "$1" deep' _ "$TMP/dp.tar" >/dev/null 2>&1; then fail "--deep пропустил сбой tar -x"; fi

# снос томов → чистый стек → restore
docker compose down -v --remove-orphans
docker compose up -d postgres api caddy
wait_health
[ "$(docker compose exec -T postgres psql -U postgres -d planar -Atc "select count(*) from users where password_hash <> '!'")" = 0 ] || fail "стек не чистый"
./ops/restore.sh "$arc"
# непустая база без --force отвергается
# (относительный путь из другого каталога разрешается; отказ именно из-за данных, не из-за usage)
out="$(cd "$(dirname "$arc")" && "$OLDPWD/ops/restore.sh" "$(basename "$arc")" 2>&1)" && fail "restore без --force поверх данных"
case "$out" in *"уже есть пользователи"*) ;; *) fail "отказ не по данным: $out" ;; esac
# сбой запроса users (docker-обёртка роняет psql с users) без --force = отказ, а не drop
mkdir "$TMP/shim"; REAL="$(command -v docker)"
printf '#!/bin/sh\ncase "$*" in *psql*users*) exit 1;; esac\nexec %s "$@"\n' "$REAL" >"$TMP/shim/docker"; chmod +x "$TMP/shim/docker"
PATH="$TMP/shim:$PATH" ./ops/restore.sh "$arc" >/dev/null 2>&1 && fail "restore при сбое запроса users продолжился"
wait_health
snapshot >"$TMP/after"
diff "$TMP/before" "$TMP/after" || fail "данные после restore отличаются"

# ротация: фиктивные архивы за 40 дней, «сейчас» = 2026-10-25
R="$TMP/rot"; mkdir "$R"
for d in $(seq 0 39); do : >"$R/planar-$(date -u -d "2026-10-25 - $d days" +%Y%m%d)T030000Z.tar"; : >"$R/planar-$(date -u -d "2026-10-25 - $d days" +%Y%m%d)T150000Z.tar"; done
: >"$R/чужой.txt"
BACKUP_DIR="$R" PLANAR_NOW=2026-10-25T16:00:00Z ./ops/backup.sh --rotate-only
[ -f "$R/чужой.txt" ] || fail "ротация тронула чужой файл"
[ "$(ls "$R"/planar-*.tar | wc -l)" = 10 ] || fail "ротация: осталось $(ls "$R"/planar-*.tar | wc -l), ждали 10 (7 дней + 3 недели вне окна дней)"
[ -f "$R/planar-20261025T150000Z.tar" ] && [ ! -f "$R/planar-20261025T030000Z.tar" ] || fail "ротация: не самый новый за день"
echo "backup-test: OK"
