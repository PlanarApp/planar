---
type: "registry"
status: "active"
module: ""
updated: "2026-11-02"
summary: "Точка входа: модули docs/ по подпроектам, прочие документы по типам."
related: []
generated: true
---

# Индекс документации

Точка входа; руками не править (`.dpcli/dpcli docs index`). Читать по кусочку, не целиком:
- найти — `.dpcli/dpcli docs find <слова>` (путь — summary), выводы — `.dpcli/dpcli docs findings <слова>` ([реестр выводов](registry/findings.md)), журналы модулей — `.dpcli/dpcli search`;
- читать — `.dpcli/dpcli docs section <путь>` (оглавление), затем `.dpcli/dpcli docs section <путь> <номер|заголовок>`.

Модули — по подпроектам (area), внутри — по дате плана: строка на модуль, под ней — его прочие документы.

## Модули без area

- **web** — План модуля web: PWA на Vue 3, клиент синхронизации, Список, Доска, карточка задачи, Cmd+K, виды, Inbox, настройки, токены [active 2026-10-22] — [план](plan/web.md) · [контракты](contracts/web.md)
- **polish** — Доводка после фазы 2: тёплый старт до бюджета 400 мс и мелкие недочёты автоматизаций, webhooks и e2e [active 2026-10-23] — [план](plan/polish.md)
  - [docs/research/pl1-warm-start.md](research/pl1-warm-start.md) — Тёплый старт ~405–420 мс: время в чтении IndexedDB и монтировании Vue; модули и zod не причина; бюджет поднят до 450 [closed]
- **work** — План модуля work: учёт времени, спринты, автоматизации, webhooks, связи в REST/MCP, импорт, хвосты фазы 1 [active 2026-10-23] — [план](plan/work.md) · [контракты](contracts/work.md)
  - [docs/contracts/work-api.md](contracts/work-api.md) — Work contracts, part 2 — C-modules v5 and v6 (enqueue, SDK, module settings, collab fixes), REST v1 and MCP (WK-5)
  - [docs/research/wk16-budgets.md](research/wk16-budgets.md) — A/B 5×5 main против feature/work — бюджеты §7 не ухудшились за шумом; switch +8 % не доказано, хост у порогов [closed]
- **p4** — План модуля p4: повторяющиеся задачи и шаблоны, цели и вехи, email-уведомления (SMTP), внешние плагины через iframe [active 2026-10-25] — [план](plan/p4.md) · [контракты](contracts/p4.md)
- **tails** — Визуальные хвосты фазы 3: карточки доски, крошки на телефоне, раздел чата, экран входа, иконка приоритета, пустые ячейки строки [active 2026-10-25] — [план](plan/tails.md)
- **docs-en** — Перевод на английский документов, попадающих в публичный репозиторий — docs/contracts и docs/guides [closed 2026-10-30] — [план](plan/docs-en.md) · [решения](plan/docs-en/decisions.md) · [сводка](plan/docs-en/summary.md) · полный журнал: `archive/docs-en`
- **collab** — План модуля collab: чат (каналы, треды, личные сообщения, push) и документы (дерево страниц на TipTap, связь с задачами) [closed 2026-11-02] — [план](plan/collab.md) · [контракты](contracts/collab.md) · [решения](plan/collab/decisions.md) · [сводка](plan/collab/summary.md) · полный журнал: `676d0b6`
- **core** — План модуля core: каркас, БД, синхронизация, мутаторы, авторизация, файлы, уведомления, модули, API-токены, MCP [closed 2026-11-02] — [план](plan/core.md) · [контракты](contracts/core.md) · [решения](plan/core/decisions.md) · [сводка](plan/core/summary.md) · полный журнал: `93e7309`
  - [docs/contracts/core-api-v1.md](contracts/core-api-v1.md) — API tokens, Bearer, REST /api/v1 and MCP /mcp — part of C-http v8 (docs/contracts/core.md); examples are checked by the contract test [closed]
  - [docs/contracts/core-mutators.md](contracts/core-mutators.md) — Domain mutators of C-mutators v10 — names, args, rules; checked against domainMutators in packages/shared/test/check-mutators.ts [closed]
  - [docs/contracts/core-schema.md](contracts/core-schema.md) — Entities of C-schema v14 — tables, fields, nullability, scope/write/bootstrap/indexes; checked by the contract test [closed]
  - [docs/guides/mcp.md](guides/mcp.md) — Connecting an AI client to Planar over MCP: token, /mcp URL, configuration, tools, read/write permissions
- **design** — План модуля design: визуал Planar в стиле Linear — C-ui v3, оболочка, Список/Доска, карточка, настройки, mobile, скриншоты [closed 2026-11-02] — [план](plan/design.md) · [контракты](contracts/design.md) · [решения](plan/design/decisions.md) · [сводка](plan/design/summary.md) · полный журнал: `c55b909`
- **features** — План модуля features: ярус A v1 — пользовательские поля, Таблица, Календарь, связи задач [closed 2026-11-02] — [план](plan/features.md) · [контракты](contracts/features.md) · [решения](plan/features/decisions.md) · [сводка](plan/features/summary.md) · полный журнал: `f1e8baf`
- **ops** — План ops: prod-стек с Caddy и TLS, бэкапы с тестом восстановления, health и метрики, обновление, инструкция по развёртыванию [closed 2026-11-02] — [план](plan/ops.md) · [контракты](contracts/ops.md) · [решения](plan/ops/decisions.md) · [сводка](plan/ops/summary.md) · полный журнал: `7090e90`
  - [docs/guides/deploy.md](guides/deploy.md) — Deploying planar on a single VPS - .env, first start, backups and restore, upgrade, monitoring, troubleshooting
- **p3** — План модуля p3: совместное редактирование (Yjs), Timeline, Workload, дашборды, формы, GitLab (опрос API) [closed 2026-11-02] — [план](plan/p3.md) · [контракты](contracts/p3.md) · [решения](plan/p3/decisions.md) · [сводка](plan/p3/summary.md) · полный журнал: `dca93da`

## Прочие документы

### Планы (plan)

- [docs/roadmap.md](roadmap.md) — Роадмап Planar: MVP + v1(часть) + API-токены и MCP за 24 ч параллельной работы — модули, задачи, волны, контракты, приёмка

### Контракты стыков (contract)

- [docs/contracts/pwa.md](contracts/pwa.md) — C-pwa v1: usePwa() — service worker update and PWA install state for the UI [closed]

### Справка (reference)

- [docs/contracts/launch.md](contracts/launch.md) — launch contracts — SETUP_TOKEN, DB_POOL_MAX, DEMO_MODE, GET /api/setup, demo seed and reset, images, CI and release compose [closed]

### Журналы (journal)

- [docs/plan/inbox-split/decisions.md](plan/inbox-split/decisions.md) — Решения (0) и вопросы (0, отвечено 0) модуля inbox-split [closed]
- [docs/plan/inbox-split/summary.md](plan/inbox-split/summary.md) — Сводка реализации модуля inbox-split: 1 задач, итоги и оговорки исполнителей [closed]
- [docs/plan/pwa/decisions.md](plan/pwa/decisions.md) — Decisions (0) and questions (0, 0 answered) of module pwa [closed]
- [docs/plan/pwa/summary.md](plan/pwa/summary.md) — Implementation summary of module pwa: 2 tasks, executor outcomes and caveats [closed]

### Реестры (registry)

- [docs/registry/findings.md](registry/findings.md) — Реестр выводов: что мы знаем, по модулям (пишется вручную).
