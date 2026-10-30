---
title: MCP
description: Connect an AI client to Planar over MCP
---

# Connecting to Planar over MCP

The MCP server is `POST /mcp` (Streamable HTTP, sessionless). Access is by API token only; cookies are not accepted.

## 1. Token

In your Planar profile open "API tokens" → "Create", set a name and permissions:

- `read`: read tools only;
- `write`: also writes (creating and editing tasks, comments).

The `plnr_…` secret is shown once. Space permissions are the same as the token owner's. Writes made with a token are marked in the activity log.

## 2. URL

`http(s)://<host>/mcp`, where `<host>` is the address of your Planar (the `PUBLIC_URL` value).

## 3. Client configuration

Header: `Authorization: Bearer plnr_…`

Claude Code:

```bash
claude mcp add --transport http planar https://planar.example.com/mcp \
  --header "Authorization: Bearer plnr_xxxxxxxx"
```

Claude Desktop and other clients with `mcp.json`:

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

## 4. Tools

Read (any token):

- `list_spaces`: the user's spaces;
- `list_projects {spaceId?}`: projects;
- `search_tasks {query?, projectId?, statusId?, assigneeId?, limit?}`: search by title and key (`PLN-12`), case-insensitive;
- `get_task {task}`: a task (id or key) with comments;
- `my_tasks {includeDone?}`: tasks assigned to me; by default without done and cancelled.

Write (needs `write`):

- `create_task`: like `POST /api/v1/tasks`;
- `list_fields {projectId}`: custom field definitions of a project (like `GET /api/v1/projects/:id/fields`);
- `update_task {task, …, fields?}`: like `PATCH /api/v1/tasks/:task`, `fields` is `{<fieldId>: value | null}`;
- `add_comment {task, text}`: `@login` becomes a mention.

The response is compact JSON in a text block; `description` is plain text. Errors (`forbidden`, `not_found`, `invalid_request`, `conflict`) come back as a tool result with `isError: true` and a `{code, message}` body. A `read` token attempting a write gets `forbidden`. No token, or a revoked or expired one: HTTP `401`.
