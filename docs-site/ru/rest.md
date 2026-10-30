---
title: REST API
description: Как получить спецификацию OpenAPI Planar
---

# REST API

REST API живёт под `/api/v1`. Аутентификация — личный API-токен `plnr_…` с правами `read` или `write` (создание: профиль → «API-токены», см. [MCP](/ru/mcp#_1-токен)), заголовок `Authorization: Bearer plnr_…`.

Спецификацию OpenAPI 3.1 сервер собирает из zod-схем (`apps/api/src/rest/openapi.ts`) и отдаёт по адресу:

```bash
curl -fsS -H "Authorization: Bearer plnr_xxxxxxxx" https://planar.example.com/api/v1/openapi.json -o openapi.json
```

Заголовок передан на случай, если инстанс требует аутентификации для всего `/api/v1`; обязателен ли он для самого `openapi.json`, в коде контроллера не зафиксировано.

Список эндпоинтов, параметры и модели берите из этого файла: он всегда соответствует версии вашего инстанса, включая эндпоинты установленных модулей. Эндпоинты `/api/v1` MCP-инструменты `create_task`, `update_task`, `list_fields` повторяют один в один (см. [MCP](/ru/mcp)).
