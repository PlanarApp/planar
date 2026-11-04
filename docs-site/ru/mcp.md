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
- `update_task {task, …, fields?}` — как `PATCH /api/v1/tasks/:task`, `fields` — `{<fieldId>: значение | null}`;
- `add_comment {task, text}` — `@login` становится упоминанием.

Ответ — компактный JSON в текстовом блоке; `description` — простой текст. Ошибки (`forbidden`, `not_found`, `invalid_request`, `conflict`) приходят как результат инструмента с `isError: true` и телом `{code, message}`. Токен `read` на запись даёт `forbidden`. Без токена, с отозванным или просроченным — HTTP `401`.
