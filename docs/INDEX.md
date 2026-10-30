---
type: "registry"
status: "active"
module: ""
updated: "2026-10-30"
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

- **core** — План модуля core: каркас, БД, синхронизация, мутаторы, авторизация, файлы, уведомления, модули, API-токены, MCP [active 2026-10-22] — [план](plan/core.md) · [контракты](contracts/core.md)
  - [docs/contracts/core-api-v1.md](contracts/core-api-v1.md) — API-токены, Bearer, REST /api/v1 и MCP /mcp — часть C-http v8 (docs/contracts/core.md); примеры проверяет контрактный тест
  - [docs/contracts/core-mutators.md](contracts/core-mutators.md) — Мутаторы домена C-mutators v9 — имена, args, правила; сверка с domainMutators — packages/shared/test/check-mutators.ts
  - [docs/contracts/core-schema.md](contracts/core-schema.md) — Сущности C-schema v13 — таблицы, поля, nullability, scope/write/bootstrap/indexes; проверяет контрактный тест
  - [docs/guides/mcp.md](guides/mcp.md) — Подключение ИИ-клиента к Planar по MCP: токен, URL /mcp, конфигурация, инструменты, права read/write
- **web** — План модуля web: PWA на Vue 3, клиент синхронизации, Список, Доска, карточка задачи, Cmd+K, виды, Inbox, настройки, токены [active 2026-10-22] — [план](plan/web.md) · [контракты](contracts/web.md)
- **collab** — План модуля collab: чат (каналы, треды, личные сообщения, push) и документы (дерево страниц на TipTap, связь с задачами) [active 2026-10-23] — [план](plan/collab.md) · [контракты](contracts/collab.md)
- **features** — План модуля features: ярус A v1 — пользовательские поля, Таблица, Календарь, связи задач [active 2026-10-23] — [план](plan/features.md) · [контракты](contracts/features.md)
- **polish** — Доводка после фазы 2: тёплый старт до бюджета 400 мс и мелкие недочёты автоматизаций, webhooks и e2e [active 2026-10-23] — [план](plan/polish.md)
  - [docs/research/pl1-warm-start.md](research/pl1-warm-start.md) — Тёплый старт ~405–420 мс: время в чтении IndexedDB и монтировании Vue; модули и zod не причина; бюджет поднят до 450 [closed]
- **work** — План модуля work: учёт времени, спринты, автоматизации, webhooks, связи в REST/MCP, импорт, хвосты фазы 1 [active 2026-10-23] — [план](plan/work.md) · [контракты](contracts/work.md)
  - [docs/contracts/work-api.md](contracts/work-api.md) — Контракты work, часть 2 — C-modules v5 и v6 (enqueue, SDK, настройки модулей, правки collab), REST v1 и MCP (WK-5)
  - [docs/research/wk16-budgets.md](research/wk16-budgets.md) — A/B 5×5 main против feature/work — бюджеты §7 не ухудшились за шумом; switch +8 % не доказано, хост у порогов [closed]
- **design** — План модуля design: визуал Planar в стиле Linear — C-ui v3, оболочка, Список/Доска, карточка, настройки, mobile, скриншоты [active 2026-10-24] — [план](plan/design.md) · [контракты](contracts/design.md)
- **p3** — План модуля p3: совместное редактирование (Yjs), Timeline, Workload, дашборды, формы, GitLab (опрос API) [active 2026-10-24] — [план](plan/p3.md) · [контракты](contracts/p3.md)
- **ops** — План ops: prod-стек с Caddy и TLS, бэкапы с тестом восстановления, health и метрики, обновление, инструкция по развёртыванию [active 2026-10-25] — [план](plan/ops.md) · [контракты](contracts/ops.md)
  - [docs/guides/deploy.md](guides/deploy.md) — Развёртывание planar на одном VPS - .env, первый запуск, бэкапы и восстановление, обновление, мониторинг, неполадки
- **p4** — План модуля p4: повторяющиеся задачи и шаблоны, цели и вехи, email-уведомления (SMTP), внешние плагины через iframe [active 2026-10-25] — [план](plan/p4.md) · [контракты](contracts/p4.md)
- **tails** — Визуальные хвосты фазы 3: карточки доски, крошки на телефоне, раздел чата, экран входа, иконка приоритета, пустые ячейки строки [active 2026-10-25] — [план](plan/tails.md)

## Прочие документы

### Планы (plan)

- [docs/roadmap.md](roadmap.md) — Роадмап Planar: MVP + v1(часть) + API-токены и MCP за 24 ч параллельной работы — модули, задачи, волны, контракты, приёмка

### Журналы (journal)

- [docs/plan/inbox-split/decisions.md](plan/inbox-split/decisions.md) — Решения (0) и вопросы (0, отвечено 0) модуля inbox-split [closed]
- [docs/plan/inbox-split/summary.md](plan/inbox-split/summary.md) — Сводка реализации модуля inbox-split: 1 задач, итоги и оговорки исполнителей [closed]

### Реестры (registry)

- [docs/registry/findings.md](registry/findings.md) — Реестр выводов: что мы знаем, по модулям (пишется вручную).
