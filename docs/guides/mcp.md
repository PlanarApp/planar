---
type: guide
status: active
module: core
updated: 2026-10-23
summary: Connecting an AI client to Planar over MCP: token, /mcp URL, configuration, tools, read/write permissions
related: ["docs/contracts/core-api-v1.md"]
---

# Connecting to Planar over MCP

The MCP server is `POST /mcp` (Streamable HTTP, sessionless). Access is by API token only; cookies are not accepted.

## 1. Token
In your Planar profile open "API tokens" → "Create", set a name and permissions:
- `read` — read tools only;
- `write` — also writing (creating and editing tasks, comments).

The `plnr_…` secret is shown once. Permissions per space are the same as the token owner's. Writes by token are marked in the activity.

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
- `list_spaces` — the user's spaces;
- `list_projects {spaceId?}` — projects;
- `search_tasks {query?, projectId?, statusId?, statusCategory?, assigneeId?, limit?}` — search by title and key (`PLN-12`), case-insensitive; `statusCategory` — `backlog | todo | in_progress | done | cancelled`, `limit` up to 200;
- `get_task {task}` — a task (id or key) with comments;
- `my_tasks {includeDone?, statusCategory?}` — assigned to me, or with an open comment or checklist item assigned to me; by default without done and cancelled;
- `project_dictionary {projectId}` — the project's statuses (name, category), labels and members: what `statusId`, `labelIds`, `assigneeIds` mean.

Every task returned by the tools also carries `status: {name, category}`.

Write (needs `write`):
- `create_task` — like `POST /api/v1/tasks`;
- `list_fields {projectId}` — definitions of the project's custom fields (like `GET /api/v1/projects/:id/fields`);
- `update_task {task, …, fields?}` — like `PATCH /api/v1/tasks/:task`, `fields` — `{<fieldId>: value | null}`;
- `add_comment {task, text}` — `@login` becomes a mention.

The response is compact JSON in a text block; `description` is plain text. Errors (`forbidden`, `not_found`, `invalid_request`, `conflict`) arrive as a tool result with `isError: true` and the body `{code, message}`. A `read` token gets `forbidden` on writes. No token, or a revoked or expired one — HTTP `401`.
