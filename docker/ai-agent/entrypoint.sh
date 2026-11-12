#!/usr/bin/env bash
# Протокол агент-образа: контракт ai10-runner@1, docs/contracts/ai10.md §2.
set -euo pipefail
set +x

for v in PLANAR_RUN_ID PLANAR_RUN_SECRET PLANAR_LLM_URL PLANAR_RESULT_URL PLANAR_HEARTBEAT_URL PLANAR_CONTEXT_FILE; do
  if [ -z "${!v:-}" ]; then
    echo "planar-agent: не задана переменная $v" >&2
    exit 64
  fi
done
if [ ! -r "$PLANAR_CONTEXT_FILE" ]; then
  echo "planar-agent: нет файла контекста $PLANAR_CONTEXT_FILE" >&2
  exit 64
fi

RESULT=/work/result.json
AUTH="Authorization: Bearer $PLANAR_RUN_SECRET"

# Heartbeat каждые 30 с, пока жив агент; ошибки не фатальны (жнец решит сам).
heartbeat() {
  while true; do
    curl -fsS -o /dev/null -X POST -H "$AUTH" "$PLANAR_HEARTBEAT_URL" 2>/dev/null || true
    sleep 30
  done
}
heartbeat &
HB_PID=$!
trap 'kill "$HB_PID" 2>/dev/null || true' EXIT

export ANTHROPIC_BASE_URL="$PLANAR_LLM_URL"
export ANTHROPIC_API_KEY="$PLANAR_RUN_SECRET"

rm -f "$RESULT"
agent_rc=0
if [ -n "${PLANAR_AGENT_CMD:-}" ]; then
  # Внешний harness: читает $PLANAR_CONTEXT_FILE, пишет JSON в /work/result.json.
  bash -c "$PLANAR_AGENT_CMD" || agent_rc=$?
else
  {
    jq -r '.action.prompt // ""' "$PLANAR_CONTEXT_FILE"
    printf '\n\nЗадача: '
    jq -r '"\(.task.key) \(.task.title)\n\n\(.task.description // "")"' "$PLANAR_CONTEXT_FILE"
    printf '\n\nПолный контекст (JSON) — в файле %s.\n' "$PLANAR_CONTEXT_FILE"
    printf 'В конце запиши результат JSON в %s: {"verdict":"done|question|fail","comment":"..."} и необязательные поля.\n' "$RESULT"
  } | claude -p --dangerously-skip-permissions || agent_rc=$?
fi

if [ -f "$RESULT" ] && jq -e . "$RESULT" >/dev/null 2>&1; then
  body=$RESULT
else
  echo "planar-agent: результата нет или он невалиден (код агента $agent_rc)" >&2
  body=/work/result-fail.json
  jq -n '{verdict:"fail", comment:"Агент не вернул результат"}' >"$body"
fi

curl -fsS -o /dev/null -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  --data-binary "@$body" "$PLANAR_RESULT_URL"
