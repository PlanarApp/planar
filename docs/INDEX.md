---
type: "registry"
status: "active"
module: ""
updated: "2026-10-22"
summary: "Точка входа: документы docs/ по типам, строка на документ."
related: []
generated: true
---

# Индекс документации

Точка входа; руками не править (`.dpcli/dpcli docs index`). Читать по кусочку, не целиком:
- найти — `.dpcli/dpcli docs find <слова>` (путь — summary), выводы — `.dpcli/dpcli docs findings <слова>` ([реестр выводов](registry/findings.md)), журналы модулей — `.dpcli/dpcli search`;
- читать — `.dpcli/dpcli docs section <путь>` (оглавление), затем `.dpcli/dpcli docs section <путь> <номер|заголовок>`.

## Планы (plan)

- [docs/plan/core.md](plan/core.md) — План модуля core: каркас, БД, синхронизация, мутаторы, авторизация, файлы, уведомления, модули, API-токены, MCP
- [docs/plan/web.md](plan/web.md) — План модуля web: PWA на Vue 3, клиент синхронизации, Список, Доска, карточка задачи, Cmd+K, виды, Inbox, настройки, токены
- [docs/roadmap.md](roadmap.md) — Роадмап Planar: MVP + v1(часть) + API-токены и MCP за 24 ч параллельной работы — модули, задачи, волны, контракты, приёмка

## Контракты стыков (contract)

- [docs/contracts/core.md](contracts/core.md) — Контракты core — C-schema, C-sync, C-mutators, C-modules, C-http; версии в заголовках, примеры проверяет контрактный тест
- [docs/contracts/web.md](contracts/web.md) — Контракты web — C-ui (оформление, компоненты, маршруты, расширения), C-client (синхронизация), C-tasks (общий слой задач)

## Реестры (registry)

- [docs/registry/contracts.md](registry/contracts.md) — Контракты стыков по модулям: id и версии из заголовков.
- [docs/registry/findings.md](registry/findings.md) — Реестр выводов: что мы знаем, по модулям (пишется вручную).
- [docs/registry/research.md](registry/research.md) — Исследования: вывод, данные, где применено.
