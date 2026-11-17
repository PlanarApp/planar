---
type: research
status: closed
module: ai10
updated: 2026-11-17
summary: Окружение прогона «Разработка» — образ старше main, сеть только через squid; npm доступен, падает corepack (fetch без прокси, noexec /tmp); Docker закрыт намеренно
related: ["docker/ai-agent/README.md", "apps/ai-runner/README.md", "deploy/squid.conf", "docs/contracts/ai10.md"]
---

# Окружение агента в прогоне «Разработка»

Снято изнутри прогона 2026-11-17 (контейнер агента, Claude Code). Что ниже названо «проверено», выполнялось в этом прогоне.

## Образ

- База `node:24-bookworm-slim` (Debian 12, node 24.22.3, npm 11.19.1), пользователь `10001`, ENTRYPOINT `planar-agent-entrypoint`. Инструменты: git, glab 1.130.0, Claude Code 2.1.322, opencode 1.19.5, Playwright chromium (`/opt/pw`), curl, jq, ripgrep; pnpm/yarn — только шимы corepack. Нет Docker CLI и python3.
- **Запущенный образ старше `docker/ai-agent` в main.** В нём `HOME=/tmp/home`, `npm_config_cache=/tmp/home/.npm`, `XDG_CACHE_HOME=/tmp/home/.cache`, нет python3 и утилит из Dockerfile, а в entrypoint нет `run_checks` (самоприёмки проверками) — всё это есть в main (python3 — коммит 44d133e, перенос HOME в `/work` — от 2026-11-15 23:05, проверки — от 2026-11-17). Слои образа датированы 2026-11-15 20:48. Тег образа изнутри не виден (`AI_AGENT_IMAGE` задаётся в `.env` api).
- Контейнер (`apps/ai-runner/src/server.ts`): read-only rootfs, `CapDrop ALL` (все capability нули), `no-new-privileges`, `/work` — бинд на диск (ext4, exec), `/tmp` — tmpfs 256 МБ с флагами `nosuid,nodev,noexec` (`noexec` docker добавляет по умолчанию: в `Tmpfs` указано `rw,nosuid,size=256m` без `exec`).

## Сеть

- Сеть `planar_agents` — `internal: true` (compose.yml): прямого выхода нет. Внешний DNS не резолвится (`getent hosts registry.npmjs.org` — пусто; прямой `curl --noproxy '*'` к registry.npmjs.org — код 6, к 1.1.1.1:443 — код 7). Резолвятся только `squid` и `api`.
- Выход — только через squid: env `HTTP_PROXY`/`HTTPS_PROXY=http://squid:3128`, `NO_PROXY=api`. `deploy/squid.conf` разрешает любые домены и порты (включая CONNECT) для частных адресов. Проверено через прокси: registry.npmjs.org — 200, gitlab.com — 301, registry.gitlab.com — 401 (нужен вход), github.com — 200, pypi.org — 200, deb.debian.org — 200.
- api (`http://api:3000`) — напрямую: LLM-прокси, heartbeat, события, результат.

## Почему «недоступен registry.npmjs.org»

Реестр доступен: `npm view pnpm version` и `pnpm info` (у npm и pnpm свой HTTP-клиент, он читает `HTTPS_PROXY`) работают. Ошибка `getaddrinfo EAI_AGAIN registry.npmjs.org` — от **corepack**, когда шим `pnpm` впервые скачивает pnpm из `packageManager` (`pnpm@12.15.0`):

1. corepack качает через встроенный `fetch` Node (undici), а он без `NODE_USE_ENV_PROXY=1` не смотрит на `HTTPS_PROXY` и идёт напрямую — DNS во внутренней сети не отвечает.
2. С `NODE_USE_ENV_PROXY=1` загрузка проходит, но бинарник ложится в `$XDG_CACHE_HOME/node/corepack` = `/tmp/home/.cache/…`, а `/tmp` — `noexec`: `spawnSync … pnpm-native EACCES`.

Проверено: `NODE_USE_ENV_PROXY=1 COREPACK_HOME=/work/<каталог> pnpm -v` → `12.15.0`; затем `pnpm install --frozen-lockfile` — «Done in 11.4s». Обход из промпта «Разработки» (`npm i -g pnpm`) работает по той же причине: npm ходит через прокси.

## Почему нет Docker

Так задумано (контракт ai10, `apps/ai-runner/README.md`): `docker.sock` есть только у ai-runner; доступ к нему равен root на хосте. В контейнере агента нет сокета, CLI и capability, rootfs только для чтения — docker-in-docker невозможен. Следствие: тестов api с БД (`TESTDB_URL`, по умолчанию `localhost:55432`, в CI — сервис `pgvector/pgvector:pg18`) локально в прогоне не запустить.

## Варианты исправления

| проблема | вариант | цена |
|---|---|---|
| образ старше main | пересобрать и обновить образ на стенде (`edge` публикуется CI с main при изменении `docker/ai-agent`), указать его в `AI_AGENT_IMAGE` | только выкладка; HOME и кэши уйдут в `/work` на диск — снимаются переполнение tmpfs и `noexec` для corepack |
| corepack без прокси | `ENV NODE_USE_ENV_PROXY=1` в `docker/ai-agent/Dockerfile` (или в env прогона от api) | одна строка; затрагивает весь `fetch` в Node — api в `NO_PROXY`, на LLM-прокси не влияет |
| corepack вообще | поставить pnpm в образ при сборке (`corepack prepare pnpm@<версия> --activate` или `npm i -g pnpm@<версия>`) | версия в образе отстаёт от `packageManager` при обновлениях |
| `noexec` на `/tmp` | не требуется после обновления образа; иначе `exec` в `Tmpfs` runner'а | ослабляет защиту ради обхода — не рекомендуется |
| БД для тестов api | (а) оставить CI — текущий порядок; (б) PostgreSQL 18 + pgvector в образе, entrypoint поднимает его от `10001` в `/work` на 55432; (в) runner поднимает на прогон отдельный контейнер postgres в `planar_agents` и передаёт `TESTDB_URL` | (б) — размер образа и память в лимите контейнера; (в) — изменение контракта ai10-runner и уборки |

Рекомендация: обновить образ на стенде и добавить `NODE_USE_ENV_PROXY=1` — после этого `pnpm install` работает без обходов; затем поправить «особенности окружения» в промпте «Разработки» (про corepack, кеш npm и сеть). Для БД — сначала (а), (в) — если локальные тесты с БД окажутся нужны агентам.
