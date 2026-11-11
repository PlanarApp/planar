---
type: reference
status: closed
module: work
updated: 2026-11-02
summary: Work contracts, part 2 — C-modules v5 and v6 (enqueue, SDK, module settings, collab fixes), REST v1 and MCP (WK-5)
related: ["docs/contracts/work.md", "docs/contracts/core-api-v1.md", "docs/contracts/core.md"]
---

# Contracts of the work module, part 2

## C-modules v7 (SDK fix per the collab contract)
v7 = v6 + the full list of values of the SDK `@planar/web/modules` (checked against collab.md §X-core item 6; no name may be lost when the branch is merged). Contract test — `apps/web/src/__contract__/sdk.contract.test.ts` (the `sdk-exports` block below).
- Required (always present):
```text sdk-exports=required
defineWebModule mutate newId rankBetween useQuery db useTask useProjectTasks useSpaces useProject useStatuses useMembers useLabels openTask useI18n i18n useWeekStart useRouter useSearch Editor uploadFile api ApiError onMutationError FilterBuilder localToday matchFilter useSession useCycles IconButton ConfirmDialog Tabs Chip AvatarStack Kbd EmptyState Toolbar
```
- C-modules v10 (design, DS-0): += `IconButton ConfirmDialog Tabs Chip AvatarStack Kbd EmptyState Toolbar` — C-ui v3 components, `docs/contracts/design.md` §Base components.
- Together with the sync client (C-sync v2, collab): if `apps/web/src/sync` exports a name, the SDK must re-export it:
```text sdk-exports=with-sync
sendTyping onTyping
```
Check of the rest of §X-core against v6: item 1 — in C-modules only the `members` type (behavior — C-sync v2 collab), items 2–3 — C-sync v2 and C-schema (collab), items 4–5 — in v6, item 6 — this list.

## C-modules v6 (WK-14)
v6 = v5 (below) + core fixes from collab (docs/contracts/collab.md §X-core in feature/collab, item 1 — type only, items 4–6). The owner of C-modules is work; collab sends fixes as a leading line "contract: …", work applies them in the next version.
- `EntityMeta.members?: { entity: string; key: string; container: string; via: string }` — type only and a shape check at module load; the behavior of `space|members` visibility is C-sync v2 (collab).
- `BackendModuleManifest.canReadFile?(q: Q, userId: string, sha256: string): Promise<boolean>` — `GET /files/:sha256` is allowed if the core's usual check denies it but any enabled module returned `true` (collab.md §X-core item 4).
- web: the extension kind `search` (`EXTENSION_KINDS` += `'search'`): `SearchDef = { id: string; label: LocalizedText; search(q: string, limit: number): Promise<{ id: string; title: string; subtitle?: string; icon?: Component; to: RouteLocationRaw }[]> }`; the Cmd+K palette shows groups of enabled modules under the tasks, a module search error/timeout does not break the palette.
- SDK `@planar/web/modules` += `Editor` (`apps/web/src/task/editor/Editor.vue`, props as is), `uploadFile` (`apps/web/src/api/files.ts`), JSON helpers `apps/web/src/api/http.ts` (same names), `onMutationError` (C-client), `useSearch` (task search, `apps/web/src/command/search.ts`). `sendTyping`/`onTyping` — together with C-sync v2 in collab.
- Module tests (`*.test.ts`) may import `apps/web/src` by a relative path to set up the client; module code — only the SDK and server-kit.

## C-modules v5 (WK-12)
v5 — additions to v4 (docs/contracts/work.md §C-modules v4), backward compatible:
- `CoreServices.enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>` — enqueueing a pg-boss job outside a mutation transaction (module controllers: ping, manual retry, import start). `push.boss: false` — does nothing.
- SDK `@planar/web/modules` += `FilterBuilder` (the core's filter builder component, `v-model: Filter`, props `{ projectId: string }`; field and `cycle` rules — as in saved views), `useRouter` (vue-router; a module navigates by routes without `location.assign`), `useCycles(projectId?)` → cycles for `FilterCtx.cycles` (empty if the sprints module is disabled).
- Module settings pages (`settings` of the manifest, C-ui `SettingsPageDef`) are shown at `/settings/:section` (`section` = `<moduleId>:<id>`), in the settings menu — after the built-in sections, enabled modules only. `SettingsPageDef` += `adminOnly?: boolean` — the item and the page are hidden from non-admins of the instance (the server still checks permissions).
- automations (server): for conditions with `cycle` — the project's cycles by an SQL query to `sprints_cycles` (the sprints module is enabled), otherwise `cycles` are not passed and rules with `'current'` are skipped (F-filter v2).

## REST and MCP (WK-5)
An addition to `docs/contracts/core-api-v1.md` (response shape, pagination, errors, token permissions — as there). Module paths with the module disabled → `404 module_disabled`. Since PJ-3 (C-schema v16) the data modules (time, sprints, automations, …) are on per project (`projects.modules`): a path addressed to a project or to a task (`POST /time-entries`, `POST /timer/start`, `GET /projects/:id/cycles`, `…/cycles/current`, `…/automations`) answers `404 module_disabled` if the module is off in that project; module-wide listings (`GET /time-entries`, `GET /timer`, MCP `current_sprint` tasks) return only the rows of projects where the module is on. The version of the API is not bumped.

| method and path | input → output |
|---|---|
| `GET /api/v1/tasks/:task/links` | → `{data: link[]}`; `link` is a `taskLinks` row |
| `POST /api/v1/tasks/:task/links` | `{target (id or key), kind}` → `201 {data: link}` (`link.create`) |
| `DELETE /api/v1/links/:id` | → `204` |
| `GET /api/v1/time-entries?taskId=&userId=&from=&to=` | → list of `timeEntries` (`userId=me`; `from`/`to` — ts by `startedAt`) |
| `POST /api/v1/time-entries` | `{task, startedAt, durationSec, note?}` → `201` entry (`time.log`) |
| `GET /api/v1/timer` | → `{data: timeEntry \| null}` — the user's running timer |
| `POST /api/v1/timer/start` | `{task}` → `201 {data: timeEntry}` |
| `POST /api/v1/timer/stop` | → `{data: timeEntry \| null}` |
| `GET /api/v1/projects/:id/cycles` | → `{data: cycle[]}` by `number` descending, no pagination |
| `GET /api/v1/projects/:id/cycles/current` | → `{data: cycle \| null}` |
| `GET /api/v1/projects/:id/automations` | → `{data: rule[]}` (read) |

MCP — new tools: `link_tasks {task, target, kind}`, `log_time {task, minutes, date?: YYYY-MM-DD, note?}` (start — 09:00 UTC of the date, default today), `start_timer {task}`, `stop_timer {}`, `current_sprint {projectId}` → the cycle and its tasks (compact). PLNRAPP-186: `unlink_tasks {id}` (as `DELETE /links/:id`, → `{ok: true}`), `list_time_entries {taskId?, userId?, from?, to?, limit?, cursor?}` (as `GET /time-entries`, → `{data, nextCursor}`), `get_timer {}`, `list_sprints {projectId}`, `list_automations {projectId}`. Writes (`link_tasks`, `unlink_tasks`, `log_time`, `start_timer`, `stop_timer`) need `write`.

## REST and MCP: documents (PLNRAPP-180)
Project pages of the docs module (data module: off in the project → `404 module_disabled`). Content in and out is markdown, converted by `@planar/editor/markdown` with the editor schema (the one collab uses; a mention goes out as `@login`). Writes are the module's mutations (`docs.page.create`, `docs.page.update`, `docs.link.add`) under the token owner's rights. Archived pages and pages of hidden projects → `404`. A page goes out without `body`/`text`/`files`; `doc` = page + `markdown` + `tasks: [{id, key, title}]` (linked tasks visible to the user).

| method and path | input → output |
|---|---|
| `GET /api/v1/docs?projectId=&parentId=` | → `{data: page[]}` by `rank`, no pagination; `parentId` — only its children |
| `GET /api/v1/docs/:id?section=` | → `{data: doc}`; `section` (PLNRAPP-185) — `markdown` is only the section under that heading, up to the next heading of the same or higher level; no such heading → `404` listing the headings |
| `POST /api/v1/docs` | `{projectId, parentId?, title, markdown?}` → `201 {data: doc}`; the parent — a page of the same project |
| `PATCH /api/v1/docs/:id` | `{title?, markdown? \| append? \| replace?: {find, replace}}` → `{data: doc}`; `markdown` replaces the content, `append` adds to the end, `replace` (PLNRAPP-185) swaps a fragment of the current markdown that occurs exactly once (0 or more than 1 → `400`); more than one of them → `400` |
| `POST /api/v1/docs/:id/tasks` | `{task (id or key)}` → `201 {data: doc}`; a repeat does not duplicate |

MCP: `list_docs {projectId, parentId?}`, `get_doc {id, section?}`, `create_doc {projectId, parentId?, title, markdown?}`, `update_doc {id, title?, markdown?, append?, replace?}`, `link_doc_task {pageId, task}` — the same outputs; writes need `write`.
