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
