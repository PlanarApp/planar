---
type: "registry"
status: "active"
module: ""
updated: "2026-10-22"
summary: "Реестр выводов: что мы знаем, по модулям (пишется вручную)."
related: []
---

# Реестр выводов

По модулю — раздел `## <модуль>`, вывод — пункт `- …` (одна строка: вывод с числами и ссылка `путь#раздел`). Поиск — `docs findings`.

## core

- Сервер синхронизации на Postgres без Redis держит бюджет §7 на стеке dev: bootstrap 10 031 задачи — 389 мс (8,2 МБ), пустой pull — 13 мс, poke p95 — 58 мс (под load 10–20 плавает 132–561 мс), push p95 — 705 мс; порядок `changes` обеспечивает `pg_advisory_xact_lock` — docs/contracts/core.md#c-sync-v1
- Общая тестовая база на все файлы Vitest и утечка баз (487 в planar-testdb) давали ложные падения под нагрузкой; лечится своей копией базы на файл (CREATE DATABASE … TEMPLATE) и ожиданием DROP — docs/plan/core/tasks/CR-1b.json
- Guard по сырому `req.url` обходится percent-encoding (`/api/%74okens`); решения по пути — только по шаблону маршрута `req.routeOptions.url` — docs/plan/core/tasks/CR-10a.review.json

## features

- Ярус A v1 (поля 7 типов, связи, Таблица, Календарь) уложился в расширение core: C-schema v6, C-mutators v3, C-http v8 без правки C-client/C-tasks; Dexie version(1) принимает новые таблицы сам (SchemaDiff), Таблица на 10 000 задач — ≤ 100 строк в DOM, начальный JS 141 КБ gzip, e2e 22/22 — docs/contracts/features.md

## work

- Модули фазы 2 (time, sprints, automations, webhooks, import) встали на расширения ядра C-modules v3→v7 (хук afterMutation с точкой сохранения, pg-boss в транзакции, server-kit без цикла сборки api↔модули, web SDK, сущности модулей в Dexie); импорт ядра относительными путями и через @planar/api ломал сборку — docs/contracts/work.md#C-modules v4
- Бюджеты §7 после фазы 2 не ухудшились за шумом: A/B 5×5 main→work медианы cold 1713→1691, warm 425→397, mutate 22,1→23,8, switch 95,5→103,5 (+8 %, диапазоны перекрыты), realtime p95 423→444 мс; хост сам у порогов — docs/research/wk16-budgets.md#Вывод
- Webhooks: SSRF-проверка после DNS-резолва и соединение на проверенный адрес через node:http(s) lookup, повторы 60·2^(n−1) с (11 попыток ≈17 ч), подпись сверяется эталоном контракта — docs/contracts/work.md#Модуль webhooks (WK-4)
