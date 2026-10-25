#!/usr/bin/env bash
# Обновление planar без потери данных: ops/upgrade.sh [--pull]
# Порядок: бэкап → (git pull --ff-only) → метка :rollback на текущие образы api/caddy → сборка →
#   миграции новым образом ДО переключения → перезапуск api и caddy → ожидание готовности (120 с) →
#   при провале — возврат старых образов.
# --force-recreate: compose сам не пересоздаёт контейнер при смене образа под тем же именем.
# Проект и compose-файлы — из окружения (COMPOSE_PROJECT_NAME, COMPOSE_FILE), как в backup.sh.
# ПРАВИЛО МИГРАЦИЙ (для OP-5): миграции при откате НЕ откатываются, поэтому в одном релизе — только
#   расширяющие изменения (новые таблицы/колонки/индексы; без удаления и переименования), чтобы
#   старый образ работал на новой схеме. Удаляющие изменения — отдельным следующим релизом.
set -euo pipefail
cd "$(dirname "$0")/.."
. ops/lib.sh
READY_TIMEOUT=120
SVCS=(api caddy)
tagged=()

# shortcut: локальная копия; заменить на wait_ready из lib.sh, когда OP-2b её добавит.
ready() {
  local t=$((SECONDS + $1))
  while [ "$SECONDS" -lt "$t" ]; do
    dc exec -T api node -e "fetch('http://localhost:3000/api/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}
cleanup() { local i; for i in "${tagged[@]}"; do docker rmi "$i:rollback" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT
fail() { echo "upgrade: $*" >&2; exit 1; }

./ops/backup.sh || fail "бэкап не удался, ничего не тронуто"
[ "${1:-}" = --pull ] && git pull --ff-only

for s in "${SVCS[@]}"; do
  img="$(docker inspect --format '{{.Config.Image}}' "$(dc ps -q "$s")")" || fail "нет запущенного $s"
  docker image tag "$img" "$img:rollback"
  tagged+=("$img")
done
dc build "${SVCS[@]}"
dc run --rm --no-deps -T api node --input-type=module -e "import {createDb,migrate} from './dist/db/index.js'; const db=createDb(process.env.DATABASE_URL); await migrate(db); await db.\$client.end()" \
  || fail "миграции не прошли; прежний api продолжает работать"
dc up -d --no-deps --force-recreate "${SVCS[@]}"
if ready "$READY_TIMEOUT"; then echo "upgrade: OK"; exit 0; fi

echo "upgrade: новая версия не готова, откат образов (миграции не откатываются)" >&2
for img in "${tagged[@]}"; do docker image tag "$img:rollback" "$img"; done
dc up -d --no-deps --force-recreate "${SVCS[@]}"
ready "$READY_TIMEOUT" || fail "после отката api не готов"
exit 1
