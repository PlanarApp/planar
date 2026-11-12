# planar-ai-agent

Образ ИИ-агента для `ai-runner`. Протокол — контракт `ai10-runner@1` (`docs/contracts/ai10.md`, §2); здесь краткая выжимка для тех, кто делает свой образ или harness.

## Состав

node 24, pnpm (corepack), git, curl, jq, glab, dpcli, Claude Code, opencode, Playwright chromium (`/opt/pw`). Пользователь `10001`, `WORKDIR /work`, ENTRYPOINT `/usr/local/bin/planar-agent-entrypoint`. Версии — `ARG` в Dockerfile (значения-заглушки, перед сборкой сверить с актуальными).

Откуда ставится dpcli — **уточнить**: каталог `.dpcli` в контекст образа не копируется, Dockerfile клонирует `DPCLI_REPO` на `DPCLI_REF`; адрес-заглушка `example.invalid`.

Образ рассчитан на read-only rootfs и tmpfs `/tmp`, `/work`: `HOME=/tmp/home`, кэши npm и XDG — в `/tmp`.

## Вход

Переменные env (задаёт api через runner): `PLANAR_RUN_ID`, `PLANAR_RUN_SECRET`, `PLANAR_LLM_URL`, `PLANAR_RESULT_URL`, `PLANAR_HEARTBEAT_URL`, `PLANAR_CONTEXT_FILE` (`/context/context.json`). Без любой из них entrypoint завершается с кодом 64. Ключа провайдера в образе нет: Claude Code получает `ANTHROPIC_BASE_URL=$PLANAR_LLM_URL` и `ANTHROPIC_API_KEY=$PLANAR_RUN_SECRET`, а ключ подставляет LLM-прокси api.

Файл контекста: `{runId, task: {id, key, title, description, status, comments[]}, action: {key, name, prompt}, checks}`.

## Ход

1. Фоновый heartbeat: `POST $PLANAR_HEARTBEAT_URL` с `Authorization: Bearer $PLANAR_RUN_SECRET` каждые 30 с; останавливается при выходе.
2. Агент. По умолчанию `claude -p`: промпт — `action.prompt` и описание задачи из контекста, агенту велено записать результат в `/work/result.json`. Для внешнего harness задайте `PLANAR_AGENT_CMD` — команда читает файл контекста и пишет результат JSON в `/work/result.json`.
3. Результат: если `/work/result.json` есть и это валидный JSON (`jq -e`), он отправляется `POST $PLANAR_RESULT_URL` как есть; иначе отправляется `{"verdict":"fail","comment":"Агент не вернул результат"}`. Тело — `{verdict: 'done'|'question'|'fail', comment, ...}` (поля — как у llm-действия). `200` — принято, повтор — `409`.

Код выхода агента на отправку не влияет; ошибка самой отправки (curl) — ненулевой код выхода контейнера, дальше «жнец» помечает прогон `failed`. Секрет не печатается: `set +x`, env не выводится.

## Не проверено

Образ не собирался; проверены только `bash -n` и prettier.
