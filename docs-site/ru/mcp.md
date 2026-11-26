---
title: MCP
description: Подключение ИИ-клиента по MCP
---

# Подключение к Planar по MCP

Сервер MCP — `POST /mcp` (Streamable HTTP, без сессий). Вход только по API-токену; cookie не принимается.

## 1. Токен

В профиле Planar откройте «API-токены» → «Создать», задайте имя и права:

- `read` — только инструменты чтения;
- `write` — ещё и запись (создание и правка задач, комментарии).

Секрет `plnr_…` показывается один раз. Права по пространствам те же, что у владельца токена. Запись по токену помечается в активности.

## 2. URL

`http(s)://<host>/mcp`, где `<host>` — адрес вашего Planar (значение `PUBLIC_URL`).

## 3. Конфигурация клиента

Заголовок: `Authorization: Bearer plnr_…`

Claude Code:

```bash
claude mcp add --transport http planar https://planar.example.com/mcp \
  --header "Authorization: Bearer plnr_xxxxxxxx"
```

Claude Desktop и другие клиенты с `mcp.json`:

```json
{
  "mcpServers": {
    "planar": {
      "type": "http",
      "url": "https://planar.example.com/mcp",
      "headers": { "Authorization": "Bearer plnr_xxxxxxxx" }
    }
  }
}
```

## 4. Инструменты

Чтение (любой токен):

- `list_spaces` — пространства пользователя;
- `list_projects {spaceId?}` — проекты;
- `search_tasks {query?, projectId?, statusId?, statusCategory?, assigneeId?, limit?}` — поиск по заголовку и ключу (`PLN-12`), без учёта регистра; `statusCategory` — `backlog | todo | in_progress | done | cancelled`, `limit` до 200;
- `get_task {task}` — задача (id или ключ) с комментариями;
- `my_tasks {includeDone?, statusCategory?}` — назначенные мне; по умолчанию без done и cancelled;
- `project_dictionary {projectId}` — статусы проекта (название, категория), метки и участники: расшифровка `statusId`, `labelIds`, `assigneeIds`.

Каждая задача в ответах инструментов несёт ещё `status: {name, category}`.

Запись (нужен `write`):

- `create_task` — как `POST /api/v1/tasks`;
- `list_fields {projectId}` — определения пользовательских полей проекта (как `GET /api/v1/projects/:id/fields`);
- `update_task {task, …, fields?}` — как `PATCH /api/v1/tasks/:task`, `fields` — `{<fieldId>: значение | null}`, `projectId` — перенести в проект любого пространства (с подзадачами);
- `add_comment {task, text}` — `@login` становится упоминанием.

Комментарии и правки страниц документов (см. [ИИ в документах](/ru/ai-in-documents)):

- `list_doc_comments {pageId}` (чтение) — комментарии страницы `{id, parentId, authorId, text, assigneeId, resolved, createdAt}`;
- `add_doc_comment {pageId, text, parentId?, assigneeId?}` — комментарий (`@login` — упоминание); `parentId` — ответ в ветку, `assigneeId` — назначить;
- `resolve_doc_comment {pageId, id}` — отметить назначенный комментарий выполненным;
- `patch_doc {pageId, edits}` — точечные правки страницы `[{find, replace, all?}]` по её markdown; `find` — ровно одно вхождение (или `all`). Ошибки: `patch_not_found`, `patch_ambiguous`, `patch_mentions`.

### Настройки проекта, пачки и пакеты

Нужен токен `write`; права — владельца токена.

- Настройки проекта: `update_project`, `set_project_module`, `create_/update_/delete_` `status`, `label`, `field`, `automation`, `ai_action`, чтение — `list_ai_actions`. Те же операции есть в REST (`/api/v1/projects/:id/statuses` и т. д., список — в `openapi.json`).
- Фильтры `search_tasks` (и `GET /api/v1/tasks`): `labelId`, `priority`, `dueBefore`, `dueAfter`, `unassigned`, `archived`.
- `move_project {id, spaceId}` — перенести проект со всеми задачами в другое пространство; кто не участник нового пространства, теряет роль в проекте, назначения и наблюдение.
- `batch_update_tasks {taskIds | filter, patch, dryRun?}`: пачка до 100 задач (статус, проект, метки и исполнители `{add, remove}`, поля, архив). `dryRun: true` ничего не меняет, а возвращает список задач.
- `move_tasks {taskIds, statusId, before? | index?}`: перенести до 100 задач одного проекта в статус и поставить подряд перед задачей `before` (или на позицию `index`, иначе в конец) в порядке `taskIds`. Все или ни одна: при отказе — ошибка `conflict` со списком проблемных задач и причин.
- Пакеты harness и привязки событий ИИ (только админ проекта): `ai_list_packs`, `ai_upload_pack`, `ai_diff_pack`, `ai_apply_pack`, `ai_set_pack_events`. Подключения ИИ и лимиты токеном недоступны, только из сессии.
- `search_docs_site {query, lang?, section?}`: поиск по этой документации и чтение раздела по id.

Ответ — компактный JSON в текстовом блоке; `description` — простой текст. Ошибки (`forbidden`, `not_found`, `invalid_request`, `conflict`) приходят как результат инструмента с `isError: true` и телом `{code, message}`. Токен `read` на запись даёт `forbidden`. Без токена, с отозванным или просроченным — HTTP `401`.
