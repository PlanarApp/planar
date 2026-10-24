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

## collab

- Личные диалоги чата уложились в C-sync без нового протокола: scope `space|members` — строка `changes` на каждого участника (pull и WS не менялись), догрузка/снятие строк при смене участников без `_reset`, advisory lock до первого чтения мутации снял гонки `lastSeq`/`docs.lock`; e2e утечки (UI, bootstrap, pull, WS, GET /files, REST) — 0 строк третьему — docs/contracts/collab.md#X-core — правки ядра от collab (проект, шлюз)
- Чат и документы на итоговой ветке: лента 10 000 сообщений без длинных кадров (57→0, кадр p95 50→16,8 мс; причина — монтирование строки: toLocaleTimeString, панель действий, Avatar), отправка p95 43,7 мс ≤ 50; §7 n=10: switch p95 медиана 91 мс, warm 409 мс (бюджет 400), cold 1704, mutate 22,1, realtime p95 430, начальный JS 151,5 КБ; e2e web 35/35 — docs/contracts/collab.md#CH-web v1 (CL-2)

## p3
- Совместное редактирование без правки C-sync/C-mutators: Y.Doc в `ydocs`, проекция в `body`/`description` через существующие мутаторы от последнего правившего; внешняя запись — только при смене body (иначе откат набора) — `docs/contracts/p3.md#P3-ydoc v1 (PT-1)`.
- Личный дашборд — внутри пространства: `spaceId null` требовал правки прав серверного Tx (условие остановки) — `docs/contracts/p3.md#P3-dashboards v2 (PT-4)`.
- Timeline: своя виртуализация, 10 000 задач — 0 long task > 50 мс за 2 с прокрутки (PT-2); страница формы `/f/*` — 2,8 КБ gzip; initial gzip 176,6 КБ после C-ui v4 (было 154).
- Параллельные задачи с миграциями drizzle конфликтуют в `meta/_journal.json`: сливать по одной, следующая пересоздаёт миграцию поверх.

## design
- Визуал «как Linear» (C-ui v4, 17 компонентов, 48 скриншотных эталонов): §7 после design — switch p95 76.4 мс, warm 408, cold 1752, mutate 22, realtime 348 (n=3); регрессия switch +24% от пикеров в каждой строке списка снята ленивым монтированием (n=10: main 95.0 → 85.0 мс) — docs/contracts/design.md#C-ui v4 (DS-0…DS-10)
