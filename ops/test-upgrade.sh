#!/usr/bin/env bash
# Upgrade: the successful path and rollback with data preserved.
# Run: COMPOSE_PROJECT_NAME=planar-op4 HTTP_PORT=48080 HTTPS_PORT=48443 PLANAR_SUBNET=10.230.4.0/24 ./ops/test-upgrade.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-planar-upgrade-test}"
export HTTP_PORT="${HTTP_PORT:-48080}" HTTPS_PORT="${HTTPS_PORT:-48443}"
export PLANAR_SUBNET="${PLANAR_SUBNET:-10.230.4.0/24}" PLANAR_DOMAIN= POSTGRES_PASSWORD=smoke-pg-pass
export PUBLIC_URL="http://localhost:$HTTP_PORT" COOKIE_SECURE=false
export COMPOSE_FILE=compose.yml:compose.build.yml:deploy/compose.smoke.yml
TMP="$(mktemp -d)"
export BACKUP_DIR="$TMP/backups" PLANAR_DATA_DIR="$TMP/data"
# the data belongs to the container users (postgres, node): removed from a container
trap 'docker compose down -v --remove-orphans --rmi local >/dev/null 2>&1 || true; docker rmi "$COMPOSE_PROJECT_NAME-api:rollback" "$COMPOSE_PROJECT_NAME-caddy:rollback" >/dev/null 2>&1 || true; docker run --rm -v "$TMP:/t" alpine:3.20 rm -rf /t/data || true; rm -rf "$TMP"' EXIT
fail() { echo "upgrade-test: FAIL: $*" >&2; exit 1; }
URL="$PUBLIC_URL"

wait_health() {
  for _ in $(seq 1 90); do curl -sf "$URL/api/health" >/dev/null && return 0; sleep 2; done
  docker compose logs --tail 40 >&2; fail "стек не отвечает"
}
ready_code() { curl -s -o /dev/null -w '%{http_code}' "$URL/api/health/ready"; }
login() { curl -sf -c "$TMP/jar" -H "Origin: $URL" -H 'content-type: application/json' -d '{"login":"admin","password":"admin"}' "$URL/api/auth/login" >/dev/null; }
snapshot() {
  login || fail "вход admin не работает"
  echo "tasks=$(docker compose exec -T postgres psql -U postgres -d planar -Atc 'select count(*) from tasks')"
  local s
  for s in $(cat "$TMP/shas"); do
    echo "file $s served=$(curl -sf -b "$TMP/jar" "$URL/files/$s" | sha256sum | cut -d' ' -f1)"
  done
}
api_image_id() { docker inspect --format '{{.Image}}' "$(docker compose ps -q api)"; }

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

# successful path
./ops/upgrade.sh >"$TMP/up1.log" 2>&1 || { cat "$TMP/up1.log" >&2; fail "upgrade.sh код ≠ 0"; }
grep -q '^upgrade: OK' "$TMP/up1.log" || fail "нет 'upgrade: OK'"
[ "$(ready_code)" = 200 ] || fail "ready ≠ 200 после обновления"
ls "$BACKUP_DIR"/planar-*.tar >/dev/null 2>&1 || fail "архив бэкапа не появился"
snapshot >"$TMP/after1"
diff "$TMP/before" "$TMP/after1" || fail "данные изменились после обновления"
[ -z "$(docker images -q "$COMPOSE_PROJECT_NAME-api:rollback")" ] || fail "остался тег :rollback"

# rollback: the new version fails on start
old="$(api_image_id)"
BROKEN_BASE="$COMPOSE_PROJECT_NAME-api:latest" COMPOSE_FILE="$COMPOSE_FILE:ops/test/compose.broken.yml" \
  ./ops/upgrade.sh >"$TMP/up2.log" 2>&1 && fail "upgrade.sh принял сломанную версию"
[ "$(api_image_id)" = "$old" ] || fail "api не на старом образе после отката"
[ "$(ready_code)" = 200 ] || fail "ready ≠ 200 после отката"
snapshot >"$TMP/after2"
diff "$TMP/before" "$TMP/after2" || fail "данные изменились после отката"

# migration failure: the name :latest points to the previous image again, :rollback is removed
oldimg="$(docker image inspect --format '{{.Id}}' "$COMPOSE_PROJECT_NAME-api:latest")"
BROKEN_BASE="$COMPOSE_PROJECT_NAME-api:latest" COMPOSE_FILE="$COMPOSE_FILE:ops/test/compose.broken.yml:ops/test/compose.badmig.yml" \
  ./ops/upgrade.sh >"$TMP/up3.log" 2>&1 && fail "upgrade.sh принял провал миграций"
grep -q 'миграции не прошли' "$TMP/up3.log" || fail "нет сообщения о миграциях"
[ "$(docker image inspect --format '{{.Id}}' "$COMPOSE_PROJECT_NAME-api:latest")" = "$oldimg" ] || fail "тег api не вернулся на прежний образ"
[ -z "$(docker images -q "$COMPOSE_PROJECT_NAME-api:rollback")" ] || fail "остался тег :rollback после провала миграций"
[ "$(api_image_id)" = "$old" ] || fail "api не на старом образе после провала миграций"
[ "$(ready_code)" = 200 ] || fail "ready ≠ 200 после провала миграций"
echo "upgrade-test: OK"
