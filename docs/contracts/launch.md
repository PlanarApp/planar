---
type: reference
status: closed
module: launch
updated: 2026-10-30
summary: Контракты launch — SETUP_TOKEN, DB_POOL_MAX, DEMO_MODE, GET /api/setup, демо-сид и сброс, образы, CI и compose релиза
related: ["docs/plan/launch.md", "docs/contracts/ops.md"]
---

# Контракты модуля launch

Владелец — координатор launch. Потребители: задача 4 (флаги), задача 5 (демо-сид, сброс), задача 3 (образы, compose, экспорт), задача 6 (docs описывает env). Любая правка — версия +1 и `task note` потребителям. Контрактный тест — `apps/api/test/launch.contract.test.ts` (имена `launch-contract …`, правит только координатор; пишется вместе с задачей 4).

## C-launch-env v1

Новые переменные api. Парсеры — в `apps/api/src/config.ts` рядом с `parseMaxUploadMb`, ошибка конфигурации — `throw new Error('<ИМЯ>: ожидается …, получено "<raw>"')` при старте. Каждая попадает в `.env.example` и в таблицу `C-ops-env` (`docs/contracts/ops.md`, только строки; правит координатор по сигналу задачи).

| имя | по умолчанию | значение |
|---|---|---|
| `SETUP_TOKEN` | пусто | пусто — поведение как сейчас. Задан — `POST /api/setup` принимает владельца только с заголовком `X-Setup-Token`, равным значению (сравнение `timingSafeEqual`); иначе `403 forbidden`. Токен не логируется |
| `DB_POOL_MAX` | `10` | целое ≥ 1 → `new pg.Pool({ connectionString, max })`; пусто → 10; не целое или < 1 → ошибка конфигурации. Парсер `parseDbPoolMax(raw)`, `createDb(url, max?)` |
| `DEMO_MODE` | `false` | `true`/`false` (регистр не важен), пусто → `false`, иное — ошибка. Парсер `parseDemoMode(raw): boolean`. `true`: см. C-launch-demo |
| `DEMO_RESET_HOURS` | `24` | целое ≥ 1, только текст плашки в демо-режиме; сам сброс делает cron (C-launch-demo) |

## C-launch-setup v1

Публичный `GET /api/setup` → `{ needed: boolean, tokenRequired: boolean, demo: boolean, demoResetHours: number }` (`demoResetHours` = `DEMO_RESET_HOURS` для плашки; `tokenRequired` = задан `SETUP_TOKEN`; `demo` = `DEMO_MODE`). Остальные поля и `POST` — как в `setup.controller.ts`; `POST` без/с неверным токеном при заданном `SETUP_TOKEN` → `403`, токен проверяется до любых запросов в БД. Веб: экран настройки показывает поле «Setup token», когда `tokenRequired`, и шлёт его в `X-Setup-Token`.

## C-launch-demo v1

`DEMO_MODE=true` включает в api:
- плашка в вебе (по `demo` из `GET /api/setup`): `Demo — data resets every {DEMO_RESET_HOURS} h`;
- `POST /api/auth/demo-login` (публичный; при выключенном режиме — `404`): создаёт сессию пользователя с логином `demo` (роль `member`) тем же путём, что обычный вход; экран входа показывает кнопку «Try the demo» при `demo`;
- отправка email, web push и исходящих webhooks отключена (no-op, без ошибки); автоматизации не делают исходящих запросов;
- `MAX_UPLOAD_MB` по умолчанию `2`, если не задан явно;
- смена пароля и email пользователя `demo` — `403`.

**Демо-сид** — `apps/api/src/db/seed-demo.ts`, экспорт `seedDemo(db: Db, now: Date = new Date()): Promise<void>`; CLI `pnpm --filter api seed:demo [--reset]`:
- `--reset` — очистить данные (все таблицы приложения, кроме журнала миграций) и залить заново; без флага на непустой базе (есть пользователи, кроме системного) — ошибка `demo seed: database is not empty`;
- все тексты английские; детерминизм: любые случайности из фиксированного seed (PRNG с константой), чтобы два запуска с одним `now` дали идентичные данные;
- все даты — смещения от `now` (задачи со сроками на ближайшие 1–6 недель, часть просрочена на 1–5 дней, спринты: завершённый `now-28d…now-14d` и активный `now-14d…now+0d…+14d` и т. д.);
- состав: 8–12 пользователей (логины латиницей, `demo` среди них, у всех `password_hash='!'` как у системного: вход только через demo-login), аватары — встроенные в сид SVG data-URI или существующий способ аватаров проекта; 4–5 пространств (Product, Engineering, Marketing, Design, Support); проекты с задачами разных статусов/приоритетов, метки, подзадачи, чек-листы, комментарии с @упоминаниями; активный и завершённый спринт, вехи, цели, учёт времени, дашборд, документы, чат с перепиской, повторяющиеся задачи — каждый включённый модуль наполнен так, чтобы первый экран не был пустым;
- вставка через существующие репозитории/сервисы или SQL в рамках схемы; новые миграции схемы запрещены.

**Сброс** — `ops/demo-reset.sh`: вызывает `seed:demo --reset` в контейнере api стека и завершается кодом 0/1; рядом `ops/systemd/planar-demo-reset.{service,timer}` по образцу уже лежащих в `ops/systemd`. Дамп не используется: даты считаются от «сегодня», дамп бы устарел (отклонение от плана §2, обоснование выше).

## C-launch-release v2

Решение Q1: основной репозиторий — GitLab (`gitlab.com/planarhq/planar`), CI — GitLab CI, реестр — GitLab Container Registry; GitHub (`github.com/PlanarApp/planar`) — зеркало, образы дополнительно в `ghcr.io/planarapp`. Лицензия Apache-2.0. v2 заменяет v1 (там GitHub Actions/GHCR были основным путём).

- CI: `.gitlab-ci.yml` в корне — стадии lint, test (vitest), build (сборка и push образов). Образы собираются на теге `vX.Y.Z` (теги образа `X.Y.Z`, `X.Y`, `latest`) и на main (`edge`) в `$CI_REGISTRY_IMAGE/api` и `$CI_REGISTRY_IMAGE/caddy`. Только `$CI_*`-переменные, секретов в файле нет. `.github/workflows/ghcr.yml` — единственный workflow: по тегу `v*` публикует те же образы в `ghcr.io/planarapp/planar-api` и `…/planar-caddy`; lint/test на GitHub не гоняются.
- `compose.yml` для пользователей: `image: ${PLANAR_REGISTRY:-registry.gitlab.com/planarhq/planar}/api:${PLANAR_VERSION:-latest}` (и `/caddy`); `PLANAR_REGISTRY` и `PLANAR_VERSION` попадают в `.env.example` и в таблицу C-ops-env (правит координатор по сигналу задачи); `build:` остаётся в `compose.build.yml` (override для разработки/CI); поведение `.env` и C-ops-env не меняется.
- Экспорт в публичный репо: `ops/export-public.sh <каталог-назначения>` — копирует индексированное дерево `git ls-files` без путей из `ops/export-exclude.txt` (список из плана §1: `docs/plan/`, `docs/research/`, `docs/registry/`, `.dpcli/`, `.claude/`, `CLAUDE.md`, `dpcli.yml`, `e2e/_*.mjs`, `data/`, `build/`), делает один начальный коммит (или следующий — при повторе поверх существующего репо), ничего не пушит. Выход ≠ 0, если после фильтра в целевом дереве остался исключённый путь.
