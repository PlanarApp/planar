---
type: reference
status: closed
module: mcpall
updated: 2026-11-16
summary: C-ext v1 — как добавлять операции REST v1 + MCP + PARITY декларативно, в своём файле области, без правок общих файлов
related: ["docs/plan/mcpall.md", "docs/contracts/core-api-v1.md"]
---

# mcpall: C-ext v1 — расширение REST v1 и MCP

Версия — заголовок `## C-ext vN`. Меняет только координатор (версия +1, потребителям — `task note`).

## C-ext v1

Владелец — карточка MA-1 (каркас). Потребители — все карточки областей. Одна операция описывается один раз (`ExtOp`); REST-маршрут, OpenAPI, инструмент MCP, инструмент чата ИИ и проверка PARITY строятся из неё.

### Файлы

- `apps/api/src/rest/ext/types.ts` — `ExtOp`, `ExtDeps`, `ExtArea` (владелец MA-1).
- `apps/api/src/rest/ext/index.ts` — `EXT_AREAS: ExtArea[]` — список всех областей (владелец MA-1; создаёт пустые заглушки всех файлов областей, чтобы карточки областей **не правили** общие файлы).
- `apps/api/src/rest/ext/<area>.ts` — `export const area: ExtArea = { name, ops: [...] }` (владелец — карточка области). Логика, не помещающаяся в `run`, — в `ext/<area>.service.ts` рядом.
- `apps/api/test/mcp/ext-<area>.test.ts` — тесты области и её `PARITY_<AREA>` (владелец — карточка области).
- Общие файлы, которые карточки областей **не трогают**: `rest.controller.ts`, `rest.service.ts`, `openapi.ts`, `mcp/tools.ts`, `test/mcp/mcp.test.ts`. Нужна правка общего файла — `<ID> contract: <что>` координатору.

### Интерфейс

```ts
interface ExtOp {
  tool: string;                  // имя MCP-инструмента, snake_case, уникально
  description: string;           // по-русски, для aikb и чата
  method: 'get'|'post'|'put'|'patch'|'delete';
  path: string;                  // '/api/v1/spaces/{id}/members'; {имена} — параметры пути
  shape: z.ZodRawShape;          // ПОЛНЫЙ вход: параметры пути + тело (POST/PUT/PATCH) или query (GET/DELETE)
  write: boolean;                // false → читает токен read; true → нужен write
  danger?: 'delete'|'bulk';      // все удаления — 'delete'; необратимое/массовое — 'bulk'
  status?: 200|201|204;          // по умолчанию 200 (POST создания — 201, DELETE — 204)
  model?: string;                // имя схемы ответа в OpenAPI (необязательно)
  run(d: ExtDeps, userId: string, input: object, tokenId?: string): Promise<unknown>; // вернуть данные (без обёртки {data})
}
interface ExtDeps { db: Db; run(userId, muts, tokenId?): Promise<void>; visibleProject(userId, id): Promise<string>; origin: string; /* + что нужно каркасу */ }
interface ExtArea { name: string; ops: ExtOp[] }
```

### Инварианты

1. Права — только от имени `userId`: запись через существующие мутаторы (`d.run` → `executeMutations`), чтение — с проверкой видимости (как `visibleProject`). Чужой/скрытый объект — 404 `not_found`; нет прав — 403 `forbidden`. Новый мутатор — только если существующего нет и без изменений схемы БД/синхронизации (иначе гейт).
2. Ответ REST — `{data}` (как v1); MCP — `data` как JSON. Ошибки — `HttpError`.
3. Токен `read` не вызывает `write`-операции ни в REST, ни в MCP.
4. Все удаления и необратимые действия — `danger` (в чате ИИ требуют «да»).
5. Секреты не отдаются и не принимаются: подключения ИИ, SMTP/IMAP, GitLab-токены, секреты вебхуков, API-токены (выпуск/отзыв) — вне модуля.
6. Имена `tool` не пересекаются с существующими и между областями (проверяет каркас при сборке `EXT_AREAS`).
7. PARITY: тест каркаса сравнивает `METHOD path` всех `ExtOp` с путями OpenAPI, а инструменты MCP — с `tool`; `ext-<area>.test.ts` фиксирует свой `PARITY_<AREA>: Record<'METHOD path', tool>` явно и сверяет его с `area.ops`.
8. Список инструментов aikb и чат ИИ строятся из реестра: `description` обязателен, тест полноты aikb должен остаться зелёным.

### Обязательные тесты области

- каждая операция: успех под пользователем с правами; отказ чужому пользователю (`outsider`) и токену `read` для `write`;
- `danger` у каждого удаления (через `toolDefs`);
- `PARITY_<AREA>` равен операциям области.

### Хозяйство

- Файлы PNG/бинарные данные в ответах не отдаются; вложения — по лимиту размера из существующей загрузки.
- Список задач → области: `spaces` 272, `instance` 272, `tasks` 273, `attachments` 273, `views` 274, `planning` 275, `time` 275, `templates` 276, `forms` 276, `docs` 277, `chat` 278, `integrations` 279, `mailgit` 279.
- Query у GET/DELETE приходит строками: числа и булевы в `shape` — через `z.coerce`/`z.stringbool`. `model` вне известных схем OpenAPI игнорируется — не полагаться. Каркас — `ext/index.ts`, `RestController` ловит ops fallback-маршрутом `'*'` (явные маршруты имеют приоритет).
