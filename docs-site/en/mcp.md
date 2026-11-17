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
- `search_tasks {query?, projectId?, statusId?, statusCategory?, assigneeId?, limit?}`: search by title and key (`PLN-12`), case-insensitive; `statusCategory` is `backlog | todo | in_progress | done | cancelled`, `limit` up to 200;
- `get_task {task}`: a task (id or key) with comments;
- `my_tasks {includeDone?, statusCategory?}`: tasks assigned to me; by default without done and cancelled;
- `project_dictionary {projectId}`: the project's statuses (name, category), labels and members, to read `statusId`, `labelIds`, `assigneeIds`.

Every task returned by the tools also carries `status: {name, category}`.

Write (needs `write`):

- `create_task`: like `POST /api/v1/tasks`;
- `list_fields {projectId}`: custom field definitions of a project (like `GET /api/v1/projects/:id/fields`);
- `update_task {task, …, fields?}`: like `PATCH /api/v1/tasks/:task`, `fields` is `{<fieldId>: value | null}`;
- `add_comment {task, text}`: `@login` becomes a mention.

Document page comments and edits (see [AI in documents](/ai-in-documents)):

- `list_doc_comments {pageId}` (read): the page's comments `{id, parentId, authorId, text, assigneeId, resolved, createdAt}`;
- `add_doc_comment {pageId, text, parentId?, assigneeId?}`: a comment (`@login` is a mention); `parentId` replies in a thread, `assigneeId` assigns it;
- `resolve_doc_comment {pageId, id}`: marks an assigned comment done;
- `patch_doc {pageId, edits}`: precise page edits `[{find, replace, all?}]` on the page markdown; `find` must occur exactly once (or `all`). Errors: `patch_not_found`, `patch_ambiguous`, `patch_mentions`.

### Project settings, batches and packs

Needs a `write` token; permissions are the token owner's.

- Project settings: `update_project`, `set_project_module`, `create_/update_/delete_` `status`, `label`, `field`, `automation`, `ai_action`; reading is `list_ai_actions`. The same operations exist in REST (`/api/v1/projects/:id/statuses` and so on, the list is in `openapi.json`).
- `search_tasks` (and `GET /api/v1/tasks`) filters: `labelId`, `priority`, `dueBefore`, `dueAfter`, `unassigned`, `archived`.
- `batch_update_tasks {taskIds | filter, patch, dryRun?}`: a batch of up to 100 tasks (status, labels and assignees `{add, remove}`, fields, archive). `dryRun: true` changes nothing and returns the task list.
- `move_tasks {taskIds, statusId, before? | index?}`: move up to 100 tasks of one project to a status, in a row before the task `before` (or at `index`, otherwise at the end) in the order of `taskIds`. All or none: a refusal is a `conflict` error listing the problem tasks and reasons.
- Harness packs and AI event bindings (project admin only): `ai_list_packs`, `ai_upload_pack`, `ai_diff_pack`, `ai_apply_pack`, `ai_set_pack_events`. AI connections and limits are not available by token, session only.
- `search_docs_site {query, lang?, section?}`: search this documentation and read a section by id.

The response is compact JSON in a text block; `description` is plain text. Errors (`forbidden`, `not_found`, `invalid_request`, `conflict`) come back as a tool result with `isError: true` and a `{code, message}` body. A `read` token attempting a write gets `forbidden`. No token, or a revoked or expired one: HTTP `401`.
