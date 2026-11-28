# planar-ai-agent

Образ ИИ-агента для `ai-runner`. Протокол — контракт `ai10-runner@3` (`docs/contracts/ai10.md`, §2); здесь краткая выжимка для тех, кто делает свой образ или harness.

## Состав

node 24, pnpm (ставится при сборке, `ARG PNPM_VERSION` = `packageManager` корневого `package.json`; сверяет тест `apps/ai-runner/test/agent-image.test.ts`), git, curl, jq, ripgrep (нужен opencode), python3 (pip, venv), fd, tree, file, less, procps, make, patch, unzip/zip, xz, ssh-клиент, sqlite3, glab, gh (`ARG GH_VERSION`, PLNRAPP-895), Claude Code, opencode, Playwright chromium (`/opt/pw`). Пользователь `10001`, `WORKDIR /work`, ENTRYPOINT `/usr/local/bin/planar-agent-entrypoint`. Версии — `ARG` в Dockerfile (актуальны на 2026-11-12). Необязательный трафик Claude Code (телеметрия, автообновление) отключён env. Сборка: `docker build -t planar-ai-agent:1 docker/ai-agent` (~3,2 ГБ).

CI публикует образ как `registry.gitlab.com/planarhq/planar/ai-agent`: на релизных тегах — `X.Y.Z`, `X.Y`, `latest`; на `main` — `edge`, только когда менялся этот каталог. В `.env` его указывают в `AI_AGENT_IMAGE` и `AI_RUNNER_IMAGES` (см. `apps/ai-runner/README.md`).

dpcli в образ **не ставится**: источник не утверждён, шаг клонирования отключён (внешний репозиторий в образ не тянем). Когда источник будет определён — вернуть `ARG DPCLI_REPO/DPCLI_REF`, `git clone` в `/opt/dpcli`, симлинк `/usr/local/bin/dpcli` и `/opt/dpcli` в `chmod`.

Образ рассчитан на read-only rootfs, tmpfs `/tmp` и записываемый `/work` (бинд каталога хоста): `HOME=/work/.home` (там же кэши npm и XDG), `TMPDIR` и `CLAUDE_CODE_TMPDIR` — `/work/.tmp`. Они на диске, а не в ОЗУ: tmpfs `/tmp` (256 МБ) входит в лимит памяти контейнера. Удаляются вместе с `/work`. Репозиторий клонируется в `/work/repo`, поэтому эти каталоги в git не попадают.

Наружу контейнер ходит только через прокси (`HTTPS_PROXY`, `NO_PROXY`; squid пускает к любому домену, в т.ч. registry.npmjs.org). npm и pnpm читают прокси сами, поэтому `pnpm install` в прогоне идёт без обходов (PLNRAPP-328: pnpm 12.15.0, `pnpm install --frozen-lockfile` в репозитории planar — ~11 с). pnpm в образе уже есть — corepack в прогоне ничего не скачивает; если `packageManager` проекта требует другую версию, pnpm переключается на неё сам, своим клиентом через прокси. `NODE_USE_ENV_PROXY=1` включает прокси и для встроенного `fetch` node (corepack, вызванный вручную, скрипты): без него — `getaddrinfo EAI_AGAIN`.

## Вход

Переменные env (задаёт api через runner): `PLANAR_RUN_ID`, `PLANAR_RUN_SECRET`, `PLANAR_LLM_URL`, `PLANAR_RESULT_URL`, `PLANAR_HEARTBEAT_URL`, `PLANAR_CONTEXT_FILE` (`/context/context.json`). Без любой из них entrypoint завершается с кодом 64. Ключа провайдера в образе нет: Claude Code получает `ANTHROPIC_BASE_URL=$PLANAR_LLM_URL` и `ANTHROPIC_API_KEY=$PLANAR_RUN_SECRET`, а ключ подставляет LLM-прокси api.

Необязательные: `PLANAR_EVENTS_URL` (лог агента; по умолчанию `$PLANAR_RESULT_URL/events`), `PLANAR_LLM_PROTOCOL` (`anthropic` | `openai`, по умолчанию `anthropic`) и `PLANAR_LLM_MODEL`; `PLANAR_REPO_URL`, `PLANAR_REPO_KIND` (`gitlab` | `github`, по умолчанию `gitlab`), `GITLAB_HOST`, `GITLAB_TOKEN` — репозиторий проекта из подключения gitlab; у привязки GitHub (PLNRAPP-895) вместо `GITLAB_*` — `GH_TOKEN`.

Файл контекста: `{runId, repo, task: {id, key, title, description, status, comments[]}, action: {key, name, prompt}, checks}`; у поручения из комментария или чек-листа на задаче с открытым MR — ещё `mr: {iid, title, sourceBranch, webUrl}` и `assignment: {kind, id, text}` (`docs/contracts/ai10.md` §2).

## Ход

1. Фоновый heartbeat: `POST $PLANAR_HEARTBEAT_URL` с `Authorization: Bearer $PLANAR_RUN_SECRET` каждые 30 с; останавливается при выходе.
2. Репозиторий: при `PLANAR_REPO_URL` и `GITLAB_TOKEN` (или `PLANAR_REPO_KIND=github` и `GH_TOKEN`) — `git clone --filter=blob:none` в `/work/repo` (текущий каталог агента). Токен отдаёт git credential helper из env, в `.git/config` и на диске его нет; glab берёт `GITLAB_TOKEN`/`GITLAB_HOST`, gh — `GH_TOKEN` из env. Для GitHub промпт велит открыть PR (`gh pr create`) и включить автомерж (`gh pr merge --auto --squash`, без squash — `--merge`). Клон не удался — результат `fail` без запуска агента.
3. Агент. Промпт — `action.prompt` и описание задачи из контекста, агенту велено записать результат в `/work/result.json`. `PLANAR_LLM_PROTOCOL=anthropic` — `claude -p`; `openai` — `opencode run --auto` с OpenAI-совместимым провайдером на `$PLANAR_LLM_URL/v1` (конфиг в `$HOME/opencode.json`; так работают OpenAI, Gemini и прочие). Для внешнего harness задайте `PLANAR_AGENT_CMD` — команда читает файл контекста и пишет результат JSON в `/work/result.json`.
4. Лог агента (PLNRAPP-199): stdout агента идёт через `log-forward.mjs` — пачками (раз в 2 с или по 50 строк) `POST $PLANAR_EVENTS_URL` с тем же `Authorization`, тело `{lines: [...]}`. Claude Code запускается с `--output-format stream-json --verbose`, opencode — с `--format json --thinking`, stdout `PLANAR_AGENT_CMD` уходит как текст. Длинные строки внутри JSON-событий сокращаются до 4000 символов; разбор, маскирование секретов и хранение хвоста — на стороне api. Ошибка отправки или падение форвардера прогон не роняет: stdout дочитывается, код выхода — агента. Последняя пачка уходит до результата.
5. Результат: если `/work/result.json` есть и это валидный JSON (`jq -e`), он отправляется `POST $PLANAR_RESULT_URL` как есть; иначе отправляется `{"verdict":"fail","comment":"Агент не вернул результат"}`. Тело — `{verdict: 'done'|'question'|'fail', comment, ...}` (поля — как у llm-действия). `200` — принято, повтор — `409`.

Код выхода агента на отправку не влияет; ошибка самой отправки (curl) — ненулевой код выхода контейнера, дальше «жнец» помечает прогон `failed`. Секрет не печатается: `set +x`, env не выводится.

## Проверено (2026-11-12, docker 29)

Образ собирается. Через `ai-runner` контейнер стартует с read-only rootfs, `CapDrop ALL`, контекстом в `/context` и tmpfs `/work` (`mode=1777`). Heartbeat и результат уходят по протоколу, пустой `result.json` превращается в `fail`, контейнер и том удаляются. `claude -p` идёт в `PLANAR_LLM_URL/v1/messages` с секретом прогона в `x-api-key`. Ответ настоящего LLM-прокси api не проверялся.

PLNRAPP-177 (2026-11-12): dev-стек `./dev.sh up-ai`, подключение Gemini (OpenAI-совместимое), репозиторий planarhq/planar — действие «Разработка» через opencode склонировало репозиторий, сделало правку, запушило `mr/<ключ>` и открыло MR (тестовый MR закрыт). ~0,5 млн входных токенов на простую правку документации.
