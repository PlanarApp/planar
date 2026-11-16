---
type: contract
status: closed
module: aikb
updated: 2026-11-16
summary: Контракт aikb — раздел знаний о Planar (AikbSection), сборка URL (aikb-urls), общий блок и инструмент подробностей; v1
related: ["docs/plan/aikb.md"]
contracts: [{"id": "aikb-section", "version": 1}, {"id": "aikb-urls", "version": 1}]
---

# Контракт aikb — v1

Владелец — координатор aikb. Потребители: KB-1…KB-7 (карточки), промпты прогонов (llm, agent, чат, комментарии страницы).

## 1. aikb-section — раздел знаний (v1)
- Файл `modules/ai/api/aikb/sections/<id>.ts` экспортирует `export const section = { id, title, body }` (все строки; `id` = имя файла без `.ts`, kebab-case; `body` — markdown на английском, компактный, без адреса инстанса).
- Разделы: `entities` (KB-2), `mcp` (KB-3), `runs` (KB-4), `permissions` (KB-5). Раздел `urls` собирает KB-6 из `aikb-urls`.
- Реестр `modules/ai/api/aikb/index.ts` (владелец KB-6): `SECTIONS`, `core(publicUrl)` — общий блок, `detail(id)`.
- Раздел `mcp` строится из реестра `toolDefs` (apps/api/src/mcp/tools.ts), не руками. Модуль `modules/ai` не импортирует `apps/api` (rootDir сборки): `modules/ai/api/aikb/mcp-section.ts` экспортирует `mcpSection(defs: McpToolMeta[]): Section` (структурный тип `{name, description, shape, write?, danger?}`), а `toolDefs` подставляет сторона apps/api (проводка — KB-6/KB-7). Файла `sections/mcp.ts` нет.
- Тест контракта: `apps/api/test/ai/aikb.contract.test.ts` (форма каждого файла sections/).

## 2. aikb-urls — сборка ссылок (v1)
- `packages/shared/src/aikb/urls.ts`, экспорт из `@planar/shared`: `appUrl(base, target)`, где `target` — объединение `{ kind, … }` (задача по ключу, документ, личный чат, чат задачи, чат документа, проект, пространство, разделы, комментарий).
- `base` — публичный адрес инстанса (`PUBLIC_URL`, `apps/api/src/main.ts`; `config.publicUrl`), без хвостового `/`. Адрес в код не зашивается.
- Тест: каждый шаблон соответствует маршруту роутера (`apps/web/src/router.ts` и маршруты модулей); переименование маршрута ломает тест.

## 3. Общий блок (v1)
- Бюджет — не больше ~1,5 тыс. токенов (оценка: символы/4); фактический объём фиксирует KB-6 здесь.
- Подробности — инструмент MCP `ai_kb` (вход `{ section? }`: без раздела — список), по `PARITY`/REST-правилу KB-6.

## 4. Состояние после волны 2 (v1, уточнение)
- Разделы: entities, runs, automations, views-settings, permissions, recipes (файлы `sections/`) + mcp (фабрика `mcpSection(defs)`). Реестр `modules/ai/api/aikb/index.ts`: `aikbSections(defs)`, `core(publicUrl, sections?)`, `detail(sections, id?)`; экспорт из `@planar/module-ai/api`.
- Общий блок: 1724 символа, ~431 токен (бюджет 1500); 19 шаблонов URL из `appUrl`. Тест — `apps/api/test/ai/aikb-core.test.ts`.
- Инструмент `ai_kb` (`apps/api/src/mcp/tools-kb.ts`, вход `{ section? }`, неизвестный id — ошибка not_found со списком), в `MCP_ONLY` теста паритета; REST-операции нет.
