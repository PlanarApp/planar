---
type: "registry"
status: "active"
module: ""
updated: "2026-10-23"
summary: "Точка входа: документы docs/ по типам, строка на документ."
related: []
generated: true
---

# Индекс документации

Точка входа; руками не править (`.dpcli/dpcli docs index`). Читать по кусочку, не целиком:
- найти — `.dpcli/dpcli docs find <слова>` (путь — summary), выводы — `.dpcli/dpcli docs findings <слова>` ([реестр выводов](registry/findings.md)), журналы модулей — `.dpcli/dpcli search`;
- читать — `.dpcli/dpcli docs section <путь>` (оглавление), затем `.dpcli/dpcli docs section <путь> <номер|заголовок>`.

## Описания систем (guide)

- [docs/deploy.md](deploy.md) — Prod-стек compose.yml (postgres, api, Caddy) и смоук ./dev.sh prod-smoke
- [docs/guides/mcp.md](guides/mcp.md) — Подключение ИИ-клиента к Planar по MCP: токен, URL /mcp, конфигурация, инструменты, права read/write

## Планы (plan)

- [docs/plan/core.md](plan/core.md) — План модуля core: каркас, БД, синхронизация, мутаторы, авторизация, файлы, уведомления, модули, API-токены, MCP
- [docs/plan/features.md](plan/features.md) — План модуля features: ярус A v1 — пользовательские поля, Таблица, Календарь, связи задач
- [docs/plan/web.md](plan/web.md) — План модуля web: PWA на Vue 3, клиент синхронизации, Список, Доска, карточка задачи, Cmd+K, виды, Inbox, настройки, токены
- [docs/plan/work.md](plan/work.md) — План модуля work: учёт времени, спринты, автоматизации, webhooks, связи в REST/MCP, импорт, хвосты фазы 1
- [docs/roadmap.md](roadmap.md) — Роадмап Planar: MVP + v1(часть) + API-токены и MCP за 24 ч параллельной работы — модули, задачи, волны, контракты, приёмка

## Контракты стыков (contract)

- [docs/contracts/core.md](contracts/core.md) — Контракты core — C-schema, C-sync, C-mutators, C-modules, C-http; версии в заголовках, примеры проверяет контрактный тест
- [docs/contracts/features.md](contracts/features.md) — Контракты features — пользовательские поля, связи задач, фильтры по полям, виды «Таблица» и «Календарь»
- [docs/contracts/web.md](contracts/web.md) — Контракты web — C-ui, C-client (синхронизация), C-tasks (слой задач), C-views (экран проекта и стык видов)

## Справка (reference)

- [docs/contracts/core-api-v1.md](contracts/core-api-v1.md) — API-токены, Bearer, REST /api/v1 и MCP /mcp — часть C-http v8 (docs/contracts/core.md); примеры проверяет контрактный тест
- [docs/contracts/core-mutators.md](contracts/core-mutators.md) — Мутаторы домена C-mutators v3 — имена, args, правила; сверка с domainMutators — packages/shared/test/check-mutators.ts
- [docs/contracts/work-api.md](contracts/work-api.md) — Контракты work, часть 2 — C-modules v5 (CoreServices.enqueue, SDK FilterBuilder и router, страницы настроек модулей), REST v1 и MCP (WK-5)
- [docs/contracts/work.md](contracts/work.md) — Контракты work — C-modules v3, C-schema v7, F-filter v2, модули time, sprints, automations, webhooks, import, REST/MCP

## Реестры (registry)

- [docs/registry/contracts.md](registry/contracts.md) — Контракты стыков по модулям: id и версии из заголовков.
- [docs/registry/findings.md](registry/findings.md) — Реестр выводов: что мы знаем, по модулям (пишется вручную).
- [docs/registry/research.md](registry/research.md) — Исследования: вывод, данные, где применено.
