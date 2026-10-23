#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

DEV=(docker compose -f compose.dev.yml)

testdb() {
  if [ "$(docker inspect -f '{{.State.Running}}' planar-testdb 2>/dev/null || true)" = true ]; then
    :
  elif docker inspect planar-testdb >/dev/null 2>&1; then
    docker start planar-testdb >/dev/null
  else
    # параллельные копии делят один контейнер; гонка двух create — второй получит ошибку и просто стартует/ждёт
    docker run -d --name planar-testdb -p 55432:5432 -e POSTGRES_PASSWORD=postgres \
      pgvector/pgvector:pg18 >/dev/null 2>&1 || docker start planar-testdb >/dev/null 2>&1 || true
  fi
  for _ in $(seq 1 60); do
    docker exec planar-testdb pg_isready -U postgres -h localhost >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "planar-testdb не поднялся" >&2
  return 1
}

# VAPID-ключи для Web Push: дописывает в ./.env, если их там нет (без внешних пакетов)
vapid() {
  touch .env
  grep -qE '^VAPID_PUBLIC_KEY=.+' .env && grep -qE '^VAPID_PRIVATE_KEY=.+' .env && return 0
  # неполную пару убираем, чтобы ключи были парными
  sed -i '/^VAPID_\(PUBLIC_KEY\|PRIVATE_KEY\|SUBJECT\)=/d' .env
  node -e "
    const {privateKey}=require('crypto').generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    const j=privateKey.export({format:'jwk'});
    const b=(s)=>Buffer.from(s,'base64url');
    const pub=Buffer.concat([Buffer.from([4]),b(j.x),b(j.y)]).toString('base64url');
    console.log('VAPID_PUBLIC_KEY='+pub+'\nVAPID_PRIVATE_KEY='+j.d+'\nVAPID_SUBJECT=mailto:admin@localhost');
  " >> .env
}

cmd="${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
  vapid) vapid ;;
  up) vapid; "${DEV[@]}" up -d --build ;;
  down) "${DEV[@]}" down ;;
  reset) "${DEV[@]}" down -v && "${DEV[@]}" up -d --build ;;
  seed) "${DEV[@]}" exec -T api pnpm --filter @planar/api seed "$@" ;;
  logs) "${DEV[@]}" logs -f "$@" ;;
  testdb) testdb ;;
  test) testdb && pnpm test "$@" ;;
  *) echo "usage: ./dev.sh up|down|reset|seed|logs|test|testdb|vapid" >&2; exit 2 ;;
esac
