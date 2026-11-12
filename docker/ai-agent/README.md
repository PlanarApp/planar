# planar-ai-agent

Образ ИИ-агента для `ai-runner`. Протокол — контракт `ai10-runner@3` (`docs/contracts/ai10.md`, §2); здесь краткая выжимка для тех, кто делает свой образ или harness.

## Состав

node 24, pnpm (corepack), git, curl, jq, ripgrep (нужен opencode), glab, Claude Code, opencode, Playwright chromium (`/opt/pw`). Пользователь `10001`, `WORKDIR /work`, ENTRYPOINT `/usr/local/bin/planar-agent-entrypoint`. Версии — `ARG` в Dockerfile (актуальны на 2026-11-12). Необязательный трафик Claude Code (телеметрия, автообновление) отключён env, иначе его режет squid. Сборка: `docker build -t planar-ai-agent:1 docker/ai-agent` (~3,2 ГБ).

dpcli в образ **не ставится**: источник не утверждён, шаг клонирования отключён (внешний репозиторий в образ не тянем). Когда источник будет определён — вернуть `ARG DPCLI_REPO/DPCLI_REF`, `git clone` в `/opt/dpcli`, симлинк `/usr/local/bin/dpcli` и `/opt/dpcli` в `chmod`.

Образ рассчитан на read-only rootfs и tmpfs `/tmp`, `/work`: `HOME=/tmp/home`, кэши npm и XDG — в `/tmp`.

## Вход

Переменные env (задаёт api через runner): `PLANAR_RUN_ID`, `PLANAR_RUN_SECRET`, `PLANAR_LLM_URL`, `PLANAR_RESULT_URL`, `PLANAR_HEARTBEAT_URL`, `PLANAR_CONTEXT_FILE` (`/context/context.json`). Без любой из них entrypoint завершается с кодом 64. Ключа провайдера в образе нет: Claude Code получает `ANTHROPIC_BASE_URL=$PLANAR_LLM_URL` и `ANTHROPIC_API_KEY=$PLANAR_RUN_SECRET`, а ключ подставляет LLM-прокси api.

Необязательные: `PLANAR_LLM_PROTOCOL` (`anthropic` | `openai`, по умолчанию `anthropic`) и `PLANAR_LLM_MODEL`; `PLANAR_REPO_URL`, `GITLAB_HOST`, `GITLAB_TOKEN` — репозиторий проекта из подключения gitlab.

Файл контекста: `{runId, repo, task: {id, key, title, description, status, comments[]}, action: {key, name, prompt}, checks}`.

## Ход

1. Фоновый heartbeat: `POST $PLANAR_HEARTBEAT_URL` с `Authorization: Bearer $PLANAR_RUN_SECRET` каждые 30 с; останавливается при выходе.
2. Репозиторий: при `PLANAR_REPO_URL` и `GITLAB_TOKEN` — `git clone --filter=blob:none` в `/work/repo` (текущий каталог агента). Токен отдаёт git credential helper, в `.git/config` его нет; glab берёт `GITLAB_TOKEN`/`GITLAB_HOST` из env. Клон не удался — результат `fail` без запуска агента.
3. Агент. Промпт — `action.prompt` и описание задачи из контекста, агенту велено записать результат в `/work/result.json`. `PLANAR_LLM_PROTOCOL=anthropic` — `claude -p`; `openai` — `opencode run --auto` с OpenAI-совместимым провайдером на `$PLANAR_LLM_URL/v1` (конфиг в `/tmp/home/opencode.json`; так работают OpenAI, Gemini и прочие). Для внешнего harness задайте `PLANAR_AGENT_CMD` — команда читает файл контекста и пишет результат JSON в `/work/result.json`.
4. Результат: если `/work/result.json` есть и это валидный JSON (`jq -e`), он отправляется `POST $PLANAR_RESULT_URL` как есть; иначе отправляется `{"verdict":"fail","comment":"Агент не вернул результат"}`. Тело — `{verdict: 'done'|'question'|'fail', comment, ...}` (поля — как у llm-действия). `200` — принято, повтор — `409`.

Код выхода агента на отправку не влияет; ошибка самой отправки (curl) — ненулевой код выхода контейнера, дальше «жнец» помечает прогон `failed`. Секрет не печатается: `set +x`, env не выводится.

## Проверено (2026-11-12, docker 29)

Образ собирается. Через `ai-runner` контейнер стартует с read-only rootfs, `CapDrop ALL`, контекстом в `/context` и tmpfs `/work` (`mode=1777`). Heartbeat и результат уходят по протоколу, пустой `result.json` превращается в `fail`, контейнер и том удаляются. `claude -p` идёт в `PLANAR_LLM_URL/v1/messages` с секретом прогона в `x-api-key`. Ответ настоящего LLM-прокси api не проверялся.

PLNRAPP-177 (2026-11-12): dev-стек `./dev.sh up-ai`, подключение Gemini (OpenAI-совместимое), репозиторий planarhq/planar — действие «Разработка» через opencode склонировало репозиторий, сделало правку, запушило `mr/<ключ>` и открыло MR (тестовый MR закрыт). ~0,5 млн входных токенов на простую правку документации.
