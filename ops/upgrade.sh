#!/usr/bin/env bash
# Upgrade planar without data loss: ops/upgrade.sh [--pull]
# Order: backup → (git pull --ff-only) → :rollback tag on the current api/caddy images → build →
#   migrations with the new image BEFORE switching → restart api and caddy → wait for readiness (120 s) →
#   on failure — return the old images.
# --force-recreate: compose does not recreate the container by itself when the image changes under the same name.
# Project and compose files come from the environment (COMPOSE_PROJECT_NAME, COMPOSE_FILE), as in backup.sh.
# MIGRATION RULE (for OP-5): migrations are NOT rolled back on rollback, so within one release only
#   expanding changes (new tables/columns/indexes; no deletion or renaming), so that
#   the old image works on the new schema. Deleting changes go in a separate next release.
set -euo pipefail
cd "$(dirname "$0")/.."
. ops/lib.sh
READY_TIMEOUT=120
SVCS=(api caddy)
tagged=()

# A repository without a tag (the tag is only after ':' in the last component; the registry port is not touched).
rb() { local b=$1; [[ ${b##*/} == *:* ]] && b=${b%:*}; echo "$b:rollback"; }
cleanup() { local i; for i in "${tagged[@]}"; do docker rmi "$(rb "$i")" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT
fail() { echo "upgrade: $*" >&2; exit 1; }

restore_tags() { local i; for i in "${tagged[@]}"; do docker image tag "$(rb "$i")" "$i"; done; }

main() {
# After pull the script may have changed: we restart the fresh version without --pull (the backup is already done).
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
