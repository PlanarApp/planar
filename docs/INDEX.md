---
type: "registry"
status: "active"
module: ""
updated: "2026-10-25"
summary: "Точка входа: документы docs/ по типам, строка на документ."
related: []
generated: true
---

# Индекс документации

Точка входа; руками не править (`.dpcli/dpcli docs index`). Читать по кусочку, не целиком:
- найти — `.dpcli/dpcli docs find <слова>` (путь — summary), выводы — `.dpcli/dpcli docs findings <слова>` ([реестр выводов](registry/findings.md)), журналы модулей — `.dpcli/dpcli search`;
- читать — `.dpcli/dpcli docs section <путь>` (оглавление), затем `.dpcli/dpcli docs section <путь> <номер|заголовок>`.

## Описания систем (guide)

- [docs/guides/deploy.md](guides/deploy.md) — Развёртывание planar на одном VPS - .env, первый запуск, бэкапы и восстановление, обновление, мониторинг, неполадки
- [docs/guides/mcp.md](guides/mcp.md) — Подключение ИИ-клиента к Planar по MCP: токен, URL /mcp, конфигурация, инструменты, права read/write

## Планы (plan)

- [docs/plan/collab.md](plan/collab.md) — План модуля collab: чат (каналы, треды, личные сообщения, push) и документы (дерево страниц на TipTap, связь с задачами)
- [docs/plan/core.md](plan/core.md) — План модуля core: каркас, БД, синхронизация, мутаторы, авторизация, файлы, уведомления, модули, API-токены, MCP
- [docs/plan/design.md](plan/design.md) — План модуля design: визуал Planar в стиле Linear — C-ui v3, оболочка, Список/Доска, карточка, настройки, mobile, скриншоты
- [docs/plan/features.md](plan/features.md) — План модуля features: ярус A v1 — пользовательские поля, Таблица, Календарь, связи задач
- [docs/plan/ops.md](plan/ops.md) — План ops: prod-стек с Caddy и TLS, бэкапы с тестом восстановления, health и метрики, обновление, инструкция по развёртыванию
- [docs/plan/p3.md](plan/p3.md) — План модуля p3: совместное редактирование (Yjs), Timeline, Workload, дашборды, формы, GitLab (опрос API)
- [docs/plan/p4.md](plan/p4.md) — План модуля p4: повторяющиеся задачи и шаблоны, цели и вехи, email-уведомления (SMTP), внешние плагины через iframe
- [docs/plan/polish.md](plan/polish.md) — Доводка после фазы 2: тёплый старт до бюджета 400 мс и мелкие недочёты автоматизаций, webhooks и e2e
- [docs/plan/tails.md](plan/tails.md) — Визуальные хвосты фазы 3: карточки доски, крошки на телефоне, раздел чата, экран входа, иконка приоритета, пустые ячейки строки
- [docs/plan/web.md](plan/web.md) — План модуля web: PWA на Vue 3, клиент синхронизации, Список, Доска, карточка задачи, Cmd+K, виды, Inbox, настройки, токены
- [docs/plan/work.md](plan/work.md) — План модуля work: учёт времени, спринты, автоматизации, webhooks, связи в REST/MCP, импорт, хвосты фазы 1
- [docs/roadmap.md](roadmap.md) — Роадмап Planar: MVP + v1(часть) + API-токены и MCP за 24 ч параллельной работы — модули, задачи, волны, контракты, приёмка

## Контракты стыков (contract)

- [docs/contracts/core.md](contracts/core.md) — Контракты core — C-schema, C-sync, C-mutators, C-modules, C-http; версии в заголовках, примеры проверяет контрактный тест
- [docs/contracts/design.md](contracts/design.md) — Контракт C-ui v4 — токены, контраст, плотность, базовые компоненты, маршруты и точки расширения web
- [docs/contracts/features.md](contracts/features.md) — Контракты features — пользовательские поля, связи задач, фильтры по полям, виды «Таблица» и «Календарь»
- [docs/contracts/web.md](contracts/web.md) — Контракты web — C-client (синхронизация), C-tasks (слой задач), C-views (экран проекта и стык видов); C-ui — design.md

## Исследования (research)

- [docs/research/pl1-warm-start.md](research/pl1-warm-start.md) — Тёплый старт ~405–420 мс: время в чтении IndexedDB и монтировании Vue; модули и zod не причина; бюджет поднят до 450 [closed]
- [docs/research/wk16-budgets.md](research/wk16-budgets.md) — A/B 5×5 main против feature/work — бюджеты §7 не ухудшились за шумом; switch +8 % не доказано, хост у порогов [closed]

## Справка (reference)

- [docs/contracts/collab.md](contracts/collab.md) — Контракты collab — документы (DC-*), чат (CH-schema, CH-mutators, CH-api, CH-web), правки ядра для чата (X-core)
- [docs/contracts/core-api-v1.md](contracts/core-api-v1.md) — API-токены, Bearer, REST /api/v1 и MCP /mcp — часть C-http v8 (docs/contracts/core.md); примеры проверяет контрактный тест
- [docs/contracts/core-mutators.md](contracts/core-mutators.md) — Мутаторы домена C-mutators v5 — имена, args, правила; сверка с domainMutators — packages/shared/test/check-mutators.ts
- [docs/contracts/core-schema.md](contracts/core-schema.md) — Сущности C-schema v10 — таблицы, поля, nullability, scope/write/bootstrap/indexes; проверяет контрактный тест
- [docs/contracts/ops.md](contracts/ops.md) — Контракты ops — env prod-стека, тома, заголовки Caddy и CSP, формат бэкапа v1, /api/health/ready и /api/metrics
- [docs/contracts/p3.md](contracts/p3.md) — Контракты p3 — совместное редактирование (/collab, ydocs, проекция), сущности и мутаторы timeline, workload, dashboards, forms, gitlab
- [docs/contracts/p4.md](contracts/p4.md) — Контракты p4 — сущности, мутаторы, задачи pg-boss и REST модулей recurring, templates, goals, email, plugins; протокол postMessage плагинов
- [docs/contracts/work-api.md](contracts/work-api.md) — Контракты work, часть 2 — C-modules v5 и v6 (enqueue, SDK, настройки модулей, правки collab), REST v1 и MCP (WK-5)
- [docs/contracts/work.md](contracts/work.md) — Контракты work — C-modules v3, C-schema v7, F-filter v2, модули time, sprints, automations, webhooks, import, REST/MCP

## Реестры (registry)

- [docs/registry/contracts.md](registry/contracts.md) — Контракты стыков по модулям: id и версии из заголовков.
- [docs/registry/findings.md](registry/findings.md) — Реестр выводов: что мы знаем, по модулям (пишется вручную).
- [docs/registry/research.md](registry/research.md) — Исследования: вывод, данные, где применено.
