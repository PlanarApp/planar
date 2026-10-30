---
type: "registry"
status: "active"
module: ""
updated: "2026-10-30"
summary: "Entry point: docs/ modules by area, other documents by type."
related: []
generated: true
---

# Documentation index

Entry point; do not edit by hand (`.dpcli/dpcli docs index`). Read piece by piece, not whole:
- find: `.dpcli/dpcli docs find <words>` (path - summary), findings: `.dpcli/dpcli docs findings <words>` ([findings registry](registry/findings.md)), module journals: `.dpcli/dpcli search`;
- read: `.dpcli/dpcli docs section <path>` (table of contents), then `.dpcli/dpcli docs section <path> <number|heading>`.

Modules by area, then by plan date: one line per module, its other documents below.

## Modules without area

- **core** — План модуля core: каркас, БД, синхронизация, мутаторы, авторизация, файлы, уведомления, модули, API-токены, MCP [active 2026-10-22] — [plan](plan/core.md) · [contracts](contracts/core.md)
  - [docs/contracts/core-api-v1.md](contracts/core-api-v1.md) — API-токены, Bearer, REST /api/v1 и MCP /mcp — часть C-http v8 (docs/contracts/core.md); примеры проверяет контрактный тест
  - [docs/contracts/core-mutators.md](contracts/core-mutators.md) — Мутаторы домена C-mutators v5 — имена, args, правила; сверка с domainMutators — packages/shared/test/check-mutators.ts
  - [docs/contracts/core-schema.md](contracts/core-schema.md) — Сущности C-schema v9 — таблицы, поля, nullability, scope/write/bootstrap/indexes; проверяет контрактный тест
  - [docs/guides/mcp.md](guides/mcp.md) — Подключение ИИ-клиента к Planar по MCP: токен, URL /mcp, конфигурация, инструменты, права read/write
- **web** — План модуля web: PWA на Vue 3, клиент синхронизации, Список, Доска, карточка задачи, Cmd+K, виды, Inbox, настройки, токены [active 2026-10-22] — [plan](plan/web.md) · [contracts](contracts/web.md)
- **collab** — План модуля collab: чат (каналы, треды, личные сообщения, push) и документы (дерево страниц на TipTap, связь с задачами) [active 2026-10-23] — [plan](plan/collab.md) · [contracts](contracts/collab.md)
- **features** — План модуля features: ярус A v1 — пользовательские поля, Таблица, Календарь, связи задач [active 2026-10-23] — [plan](plan/features.md) · [contracts](contracts/features.md)
- **polish** — Доводка после фазы 2: тёплый старт до бюджета 400 мс и мелкие недочёты автоматизаций, webhooks и e2e [active 2026-10-23] — [plan](plan/polish.md)
  - [docs/research/pl1-warm-start.md](research/pl1-warm-start.md) — Тёплый старт ~405–420 мс: время в чтении IndexedDB и монтировании Vue; модули и zod не причина; бюджет поднят до 450 [closed]
- **work** — План модуля work: учёт времени, спринты, автоматизации, webhooks, связи в REST/MCP, импорт, хвосты фазы 1 [active 2026-10-23] — [plan](plan/work.md) · [contracts](contracts/work.md)
  - [docs/contracts/work-api.md](contracts/work-api.md) — Контракты work, часть 2 — C-modules v5 и v6 (enqueue, SDK, настройки модулей, правки collab), REST v1 и MCP (WK-5)
  - [docs/research/wk16-budgets.md](research/wk16-budgets.md) — A/B 5×5 main против feature/work — бюджеты §7 не ухудшились за шумом; switch +8 % не доказано, хост у порогов [closed]
- **design** — План модуля design: визуал Planar в стиле Linear — C-ui v3, оболочка, Список/Доска, карточка, настройки, mobile, скриншоты [active 2026-10-24] — [plan](plan/design.md) · [contracts](contracts/design.md)
- **p3** — План модуля p3: совместное редактирование (Yjs), Timeline, Workload, дашборды, формы, GitLab (опрос API) [active 2026-10-24] — [plan](plan/p3.md) · [contracts](contracts/p3.md)
- **ops** — План ops: prod-стек с Caddy и TLS, бэкапы с тестом восстановления, health и метрики, обновление, инструкция по развёртыванию [active 2026-10-25] — [plan](plan/ops.md) · [contracts](contracts/ops.md)
  - [docs/guides/deploy.md](guides/deploy.md) — Развёртывание planar на одном VPS - .env, первый запуск, бэкапы и восстановление, обновление, мониторинг, неполадки
- **p4** — План модуля p4: повторяющиеся задачи и шаблоны, цели и вехи, email-уведомления (SMTP), внешние плагины через iframe [active 2026-10-25] — [plan](plan/p4.md) · [contracts](contracts/p4.md)
- **tails** — Визуальные хвосты фазы 3: карточки доски, крошки на телефоне, раздел чата, экран входа, иконка приоритета, пустые ячейки строки [active 2026-10-25] — [plan](plan/tails.md)

## Other documents

### Plans (plan)

- [docs/roadmap.md](roadmap.md) — Роадмап Planar: MVP + v1(часть) + API-токены и MCP за 24 ч параллельной работы — модули, задачи, волны, контракты, приёмка

### Interface contracts (contract)

- [docs/contracts/pwa.md](contracts/pwa.md) — C-pwa v1: usePwa() — состояние обновлений SW и установки PWA для UI [closed]

### Journals (journal)

- [docs/plan/pwa/decisions.md](plan/pwa/decisions.md) — Decisions (0) and questions (0, 0 answered) of module pwa [closed]
- [docs/plan/pwa/summary.md](plan/pwa/summary.md) — Implementation summary of module pwa: 2 tasks, executor outcomes and caveats [closed]

### Registries (registry)

- [docs/registry/findings.md](registry/findings.md) — Реестр выводов: что мы знаем, по модулям (пишется вручную).
