#!/usr/bin/env bash
# Протокол агент-образа: контракт ai10-runner@3, docs/contracts/ai10.md §2.
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
# HOME and TMPDIR live in the empty /work (on disk, not the 256 MB tmpfs /tmp); the repo is /work/repo, so they stay out of git
mkdir -p "$HOME" "$TMPDIR"
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

# Лог агента (PLNRAPP-199): stdout агента пачками уходит в api (PLANAR_EVENTS_URL), разбор и маскирование — там.
# Форвардер не роняет прогон: не запустился или упал — stdout просто дочитывается.
export PLANAR_EVENTS_URL="${PLANAR_EVENTS_URL:-$PLANAR_RESULT_URL/events}"
log_forward() { node /usr/local/lib/planar-agent/log-forward.mjs || cat >/dev/null; }

export ANTHROPIC_BASE_URL="$PLANAR_LLM_URL"
export ANTHROPIC_API_KEY="$PLANAR_RUN_SECRET"
[ -n "${PLANAR_LLM_MODEL:-}" ] && export ANTHROPIC_MODEL="$PLANAR_LLM_MODEL"

rm -f "$RESULT"
agent_rc=0

# Репозиторий проекта: подключение gitlab (GITLAB_TOKEN) или привязка GitHub (GH_TOKEN, PLNRAPP-895).
# Токен — через credential helper из переменной окружения, в .git/config и на диск не пишется; gh и glab читают его сами.
REPO=
REPO_KIND=
if [ -n "${PLANAR_REPO_URL:-}" ]; then
  if [ "${PLANAR_REPO_KIND:-gitlab}" = github ] && [ -n "${GH_TOKEN:-}" ]; then
    REPO_KIND=github
    git config --global credential.helper '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'
  elif [ -n "${GITLAB_TOKEN:-}" ]; then
    REPO_KIND=gitlab
    git config --global credential.helper '!f() { echo username=oauth2; echo "password=$GITLAB_TOKEN"; }; f'
  fi
fi
if [ -n "$REPO_KIND" ]; then
  git config --global user.name "ИИ"
  git config --global user.email "ai@planar.invalid"
  if git clone -q --filter=blob:none "$PLANAR_REPO_URL" /work/repo; then
    REPO=/work/repo
    cd "$REPO"
  elif [ "$REPO_KIND" = github ]; then
    jq -n '{verdict:"fail", comment:"Агент не смог склонировать репозиторий проекта: проверьте токен подключения GitHub (нужны права Contents и Pull requests на запись) и доступность squid."}' >"$RESULT"
  else
    jq -n '{verdict:"fail", comment:"Агент не смог склонировать репозиторий проекта: проверьте токен подключения GitLab (нужен scope api) и доступность squid."}' >"$RESULT"
  fi
fi

prompt() {
  jq -r '.action.prompt // ""' "$PLANAR_CONTEXT_FILE"
  printf '\n\nЗадача: '
  jq -r '"\(.task.key) \(.task.title)\n\n\(.task.description // "")"' "$PLANAR_CONTEXT_FILE"
  printf '\n\nПолный контекст (JSON, с комментариями) — в файле %s.\n' "$PLANAR_CONTEXT_FILE"
  if [ "$REPO_KIND" = github ] && [ -n "$REPO" ]; then
    printf 'Репозиторий проекта (GitHub) склонирован в %s (текущий каталог), git push и gh работают (токен — в GH_TOKEN). Вместо MR GitLab — PR GitHub: `gh pr create`, автомерж после проверок — `gh pr merge --auto --squash` (squash запрещён в репозитории — `--merge`); проверка — `gh pr view <PR> --json autoMergeRequest`, CI — `gh pr checks <PR>`, `gh run view <id> --log-failed`.\n' "$REPO"
  elif [ -n "$REPO" ]; then
    printf 'Репозиторий проекта склонирован в %s (текущий каталог), git push и glab работают.\n' "$REPO"
  fi
  printf 'В конце запиши результат JSON в %s: {"verdict":"done|question|fail","comment":"..."} и необязательные поля: questions[], descriptionAppend, newTasks[{title,description,status,ai,after[],checks[]}] (ai — подзадача на ИИ, after — номера подзадач списка, которые должны быть готовы раньше, checks — её критерии приёмки), moveTo, labels[], fields[{name,value}], friction (что мешало работе — неясная инструкция, не хватало данных или доступа; не мешало — null), uncertain (в чём не уверен и что проверил сам; сомнений нет — "").\n' "$RESULT"
  printf 'Результат принимает система по критериям готовности, а не по твоей оценке: команды-проверки (строки «$ …» в checks контекста) она выполнит сама после тебя.\n'
}

# PLNRAPP-404: проверки действия вида «$ команда» — после агента, в каталоге репозитория; код выхода и хвост
# вывода уходят в checkResults результата, принимает их движок api.
run_checks() {
  local c out rc results='[]'
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    set +e
    out=$(cd "${REPO:-/work}" && timeout "${PLANAR_CHECK_TIMEOUT_SEC:-900}" bash -lc "${c#\$ }" 2>&1)
    rc=$?
    set -e
    results=$(jq -c --arg c "$c" --arg o "$(printf '%s' "$out" | tail -c 4000)" --argjson ok "$([ "$rc" -eq 0 ] && echo true || echo false)" \
      '. + [{check: $c, ok: $ok, output: $o}]' <<<"$results")
  done < <(jq -r '.checks[]? | select(startswith("$ "))' "$PLANAR_CONTEXT_FILE")
  if [ "$results" != '[]' ]; then
    jq --argjson r "$results" '.checkResults = $r' "$RESULT" >"$RESULT.tmp" && mv "$RESULT.tmp" "$RESULT"
  fi
}

if [ -s "$RESULT" ]; then
  : # клонирование не удалось — результат уже готов
elif [ -n "${PLANAR_AGENT_CMD:-}" ]; then
  # Внешний harness: читает $PLANAR_CONTEXT_FILE, пишет JSON в /work/result.json; его stdout — лог прогона.
  set +e
  bash -c "$PLANAR_AGENT_CMD" | log_forward
  agent_rc=${PIPESTATUS[0]}
  set -e
elif [ "${PLANAR_LLM_PROTOCOL:-anthropic}" = anthropic ]; then
  set +e
  prompt | claude -p --dangerously-skip-permissions --output-format stream-json --verbose | log_forward
  agent_rc=${PIPESTATUS[1]}
  set -e
else
  # OpenAI-совместимый провайдер (OpenAI, Gemini, …) — opencode через LLM-прокси api.
  export OPENCODE_CONFIG="$HOME/opencode.json" OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_MODELS_FETCH=1
  jq -n --arg url "$PLANAR_LLM_URL/v1" --arg m "${PLANAR_LLM_MODEL:?не задана PLANAR_LLM_MODEL}" '{
    "$schema": "https://opencode.ai/config.json",
    autoupdate: false,
    share: "disabled",
    provider: {planar: {npm: "@ai-sdk/openai-compatible", name: "Planar",
      options: {baseURL: $url, apiKey: "{env:PLANAR_RUN_SECRET}"}, models: {($m): {name: $m}}}},
    model: ("planar/" + $m)
  }' >"$OPENCODE_CONFIG"
  set +e
  opencode run --auto --format json --thinking -m "planar/$PLANAR_LLM_MODEL" "$(prompt)" | log_forward
  agent_rc=${PIPESTATUS[0]}
  set -e
fi

# -s: jq -e accepts an empty file (exit 0) — it would go out as an empty body
if [ -s "$RESULT" ] && jq -e . "$RESULT" >/dev/null 2>&1; then
  if jq -e '.verdict == "done"' "$RESULT" >/dev/null 2>&1; then run_checks; fi
  body=$RESULT
else
  echo "planar-agent: результата нет или он невалиден (код агента $agent_rc)" >&2
  body=/work/result-fail.json
  jq -n '{verdict:"fail", comment:"Агент не вернул результат"}' >"$body"
fi

curl -fsS -o /dev/null -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  --data-binary "@$body" "$PLANAR_RESULT_URL"
