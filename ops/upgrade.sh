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

# Репозиторий без тега (тег — только после ':' в последнем компоненте; порт реестра не трогаем).
rb() { local b=$1; [[ ${b##*/} == *:* ]] && b=${b%:*}; echo "$b:rollback"; }
cleanup() { local i; for i in "${tagged[@]}"; do docker rmi "$(rb "$i")" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT
fail() { echo "upgrade: $*" >&2; exit 1; }

restore_tags() { local i; for i in "${tagged[@]}"; do docker image tag "$(rb "$i")" "$i"; done; }

main() {
# После pull скрипт мог измениться: перезапускаем свежую версию без --pull (бэкап уже сделан).
if [ -z "${UPGRADE_REEXEC:-}" ]; then
  ./ops/backup.sh || fail "бэкап не удался, ничего не тронуто"
  if [ "${1:-}" = --pull ]; then git pull --ff-only; UPGRADE_REEXEC=1 exec "$0"; fi
fi

for s in "${SVCS[@]}"; do
  img="$(docker inspect --format '{{.Config.Image}}' "$(dc ps -q "$s")")" || fail "нет запущенного $s"
  docker image tag "$img" "$(rb "$img")"
  tagged+=("$img")
done
dc build "${SVCS[@]}" || { restore_tags; fail "сборка не прошла; прежний api продолжает работать"; }
dc run --rm --no-deps -T api node --input-type=module -e "import {createDb,migrate} from './dist/db/index.js'; const db=createDb(process.env.DATABASE_URL); await migrate(db); await db.\$client.end()" \
  || { restore_tags; fail "миграции не прошли; прежний api продолжает работать"; }
dc up -d --no-deps --force-recreate "${SVCS[@]}"
if wait_ready "$READY_TIMEOUT"; then echo "upgrade: OK"; exit 0; fi

echo "upgrade: новая версия не готова, откат образов (миграции не откатываются)" >&2
restore_tags
dc up -d --no-deps --force-recreate "${SVCS[@]}"
wait_ready "$READY_TIMEOUT" || fail "после отката api не готов"
exit 1
}
main "$@"
