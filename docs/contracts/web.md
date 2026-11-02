---
type: contract
status: closed
module: web
updated: 2026-11-02
summary: Web contracts - C-client (sync), C-tasks (tasks layer), C-views (project screen and view interface); C-ui - design.md
related: ["docs/plan/web.md", "docs/contracts/core.md", "docs/contracts/design.md", "docs/roadmap.md"]
contracts: [{"id": "C-client", "version": 4}, {"id": "C-tasks", "version": 3}, {"id": "C-views", "version": 2}]
---

# Web module contracts

Owner - the web coordinator. Consumers - tasks WB-*, modules `modules/*/web` (FT-*). Only the coordinator changes it: version +1 in the heading and in `apps/web/src/contract.ts`, edit the contract test.

**C-ui** (tokens, components, routes, extension points) - `docs/contracts/design.md` (from phase 3 the owner is the design coordinator).

Contract tests - `apps/web/src/__contract__/*.contract.test.ts` (written by the coordinator, the executor does not edit them). Run: `pnpm --filter web test`. The tests find the export tables by the heading prefix "Exports", so those headings keep it.

## C-client v4

v4 (collab, CL-1a): `sendTyping(entity: string, id: string): void` (no WS - nothing), `onTyping(cb: (e: {entity: string; id: string; userId: string}) => void): () => void` - `docs/contracts/collab.md` §X-core item 2.

The sync client - `apps/web/src/sync/index.ts` (owner WB-2; consumers - WB-3...WB-10, modules). Protocol with the server - C-sync (core), mutators - C-mutators. Contract test - `apps/web/src/__contract__/client.contract.test.ts` (the exports below).

### Exports
| Name | Signature | Behavior |
|---|---|---|
| `db` | `PlanarDB` (Dexie) | a table per each `ENTITIES` entity and module entities, name = C-schema entity name, key `id`, indexes = `meta.indexes`; service tables `_meta` (`clientId`, `userId`, `cursor`, `lastMutationId`), `_queue` (`{id: number, name, args, createdAt}` + internal client fields; consumers do not read `_meta` and `_queue`) |
| `startSync` | `(opts: {userId: string; baseUrl?: string; fetch?: typeof fetch; WebSocket?: typeof WebSocket}) => Promise<void>` | warm start: a replica exists - the promise resolves right after the database opens, then pull; none - bootstrap; then WS. `_meta.userId` ≠ `opts.userId` -> `clearLocal()` first (another user's replica is never shown) |
| `stopSync` | `() => Promise<void>` | closes WS and timers; the database stays |
| `clearLocal` | `() => Promise<void>` | `stopSync`, then clears all entity tables, `_queue` and `_meta` (new `clientId`); called on logout |
| `useQuery` | `<T>(fn: () => T \| Promise<T>) => Readonly<Ref<T \| undefined>>` | liveQuery -> `shallowRef` (the value is not wrapped in a deep readonly Proxy; do not mutate the result); recomputed when the tables it read change; unsubscribes when the scope is destroyed; `fn` reads `db` |
| `mutate` | `(name: string, args: unknown) => Promise<void>` | unknown name -> `MutatorError('invalid_args')`; args are checked by the mutator's zod (error -> `invalid_args`, not queued); applies `run` to the replica in one Dexie transaction together with the `_queue` write; the promise resolves after the local apply, not after the server |
| `registerMutators` | `(defs: MutatorDef[]) => void` | duplicate name -> `Error` |
| `syncState` | `Readonly<Ref<{status: 'idle'\|'bootstrapping'\|'online'\|'offline'\|'error'; pending: number}>>` | `pending` - length of `_queue` |
| `onMutationError` | `(cb: (e: {id: number; name: string; code: string; message: string}) => void) => () => void` | a mutation rejected by the server (already rolled back by rebase) |
| `onUnauthorized` | `(cb: () => void) => () => void` | `401` or WS close 4401; the caller redirects to login |
| `onReplicaChange` | `(cb: (batch: { entity: string; id: string; row: Record<string, unknown> \| null }[]) => void) => () => void` | after every committed client write to the replica (mutate, applyServer, rebase, bootstrap) - the rows changed by the transaction, `row: null` - deleted; order - commit order; in other tabs - the same batches via BroadcastChannel `planar-replica` (exception: background bootstrap batches do not go to other tabs - when it finishes they receive a reset `*`); `reset`/`clearLocal` - the batch `[{entity: '*', id: '*', row: null}]` (reset everything) |
| `replicaState` | `Readonly<Ref<'empty' \| 'partial' \| 'complete'>>` | `partial` - bootstrap has written the open project, the rest is written in the background; the cursor is saved only at `complete`; an interrupted bootstrap restarts |
| `newId` | `() => string` | `uuidv7()` from `@planar/shared` |
| `rankBetween` | `(a: string \| null, b: string \| null) => string` | `generateKeyBetween` from `fractional-indexing` |

### Invariants
- Mutator `ctx` on the client: `{userId: opts.userId from startSync, now: new Date().toISOString(), server: false}`.
- Rebase after every pull: apply `changes` by `seq`, drop from `_queue` the mutations with `id ≤ lastMutationId`, re-apply the rest on top of the server state. A replica without unconfirmed mutations = the server state.
- `reset` (C-sync) -> clear the entity tables, bootstrap, then rebase the queue.
- The queue lives in IndexedDB and survives a reload; push in batches <= 100, retry on network error/`5xx` with a 1-30 s pause.
- The client `Tx` over Dexie passes the `txContractSuite` suite (`packages/shared/test/tx-contract.ts`).
- All writes to the replica's entity tables go only through the sync client (otherwise `onReplicaChange` does not learn about them).
- Sync cycle: push the queue first, then pull (push does not depend on the cursor, C-sync).
- Bootstrap with an empty replica: first the rows of the open project (by route `/p/:projectId` or `/t/:key`) and all entities except `tasks`/`taskAssignees`/`taskLabels`/`checklistItems`/`comments`/`attachments`/`commentReactions` of other projects, in one transaction -> `replicaState = 'partial'`; the rest - in batches <= 1000 rows in separate transactions, yielding the thread -> `complete`, then the cursor.

## C-tasks v3

The shared tasks layer for views - `apps/web/src/tasks/index.ts` (owner WB-2a; consumers WB-4...WB-10). Reads only the replica (C-client), writes only via `mutate` of domain mutators (C-mutators); does not wait for the network. Contract test - `apps/web/src/__contract__/tasks.contract.test.ts`.

### Types
- `TaskView = Row<'tasks'> & { key: string; assigneeIds: string[]; labelIds: string[] }`; `key` = `${project.key}-${number}`, with `number = null` - `${project.key}-…` (the number has not been issued by the server yet).
- `GroupBy = 'status' | 'assignee' | 'priority' | 'label'`; `SortBy = 'rank' | 'priority' | 'dueDate' | 'createdAt' | 'updatedAt' | 'title'`; `TaskGroup = { key: string; label: string; color?: string; tasks: TaskView[] }`.
- Query arguments are `MaybeRefOrGetter` (vue), the result is `Readonly<Ref<…>>` from `useQuery`; `undefined` - not read yet.

### Exports
| Name | Signature | Behavior |
|---|---|---|
| `useSpaces` | `() => Ref<(Row<'spaces'> & { projects: Row<'projects'>[] })[]>` | by `rank`; archived projects excluded |
| `useProject` | `(id) => Ref<Row<'projects'> \| null \| undefined>` | `undefined` - still reading, `null` - not in the replica |
| `useStatuses` | `(spaceId) => Ref<Row<'statuses'>[]>` | by `rank` |
| `useMembers` | `(spaceId) => Ref<Row<'users'>[]>` | users from `spaceMembers`, without deactivated ones, by `name` |
| `useLabels` | `(spaceId) => Ref<Row<'labels'>[]>` | by `name` |
| `useProjectTasks` | `(projectId) => Ref<TaskView[]>` | all tasks of the project (with subtasks); an in-memory projection: IndexedDB is read once per project, then patched via `onReplicaChange` (no re-reading); up to the 3 most recent projects in memory (LRU); with `replicaState = 'partial'` for an unread project - reads the rest when it completes |
| `prefetchProject` | `(projectId: string) => void` | builds the project projection ahead of time (hover over a project link, idle after the first project); a repeated call does nothing |
| `useTask` | `(idOrKey) => Ref<TaskView \| null \| undefined>` | uuid or key `PLN-123`; `undefined` - still reading, `null` - not in the replica |
| `groupTasks` | `(tasks, by: GroupBy, ctx: {statuses, members, labels}) => TaskGroup[]` | pure; statuses - in `rank` order, priority 1->4, then 0; "no assignee"/"no label" - the last group; a task with several assignees/labels appears in each of its groups |
| `sortTasks` | `(tasks, by: SortBy, dir: 'asc' \| 'desc') => TaskView[]` | pure, stable; `null` goes last for any `dir` |
| `createTask` | `(a: {projectId, statusId, title, after?: string \| null, before?: string \| null, parentId?, priority?, dueDate?, assigneeIds?, labelIds?}) => Promise<string>` | `after`/`before` - `rank` of the neighbors; without them - to the end; computes id and `rank` itself; returns the id |
| `updateTask` | `(id, patch: {title?, description?, statusId?, priority?, dueDate?, startDate?, projectId?, parentId?, fields?}) => Promise<void>` | `task.update` |
| `moveTask` | `(id, to: {statusId?: string; after: string \| null; before: string \| null}) => Promise<void>` | a new `rank` between the neighbors (+ status) in one mutation |
| `setAssignees` | `(taskId, userIds: string[]) => Promise<void>` | the difference -> `task.assign`/`task.unassign` |
| `setLabels` | `(taskId, labelIds: string[]) => Promise<void>` | the difference -> `task.addLabel`/`task.removeLabel` |
| `deleteTask` | `(id) => Promise<void>` | `task.delete` |
| `StatusPicker`, `AssigneePicker`, `PriorityPicker`, `DueDatePicker`, `LabelPicker` | SFC: `v-model` (status - id; assignees, labels - `string[]`; priority - `0..4`; due date - `'YYYY-MM-DD' \| null`), `spaceId` (except priority and due date), `compact?: boolean` (icon only - for rows and cards) | on `ui/Popover` + search as you type, keyboard; on `update:modelValue` the caller itself calls `updateTask`/`setAssignees`/`setLabels` |
| `StatusIcon`, `PriorityIcon` | SFC: `status: Row<'statuses'>` / `priority: number` | icon by status category and its `color`; priority - `--color-priority-*` tokens |

## C-views v2

The project screen and the view interface - `apps/web/src/views/` (skeleton - WB-4a; views - WB-4 "List", WB-5 "Board"; task panel - WB-6; consumers - WB-7, WB-8, modules). Contract test - `apps/web/src/__contract__/views.contract.test.ts`.

### Project screen `/p/:projectId/:view?`
- `ProjectScreen.vue`: header (project name and key), view tabs, the "Group by / Sort / Subtasks" panel, the view area; `?task=<key>` - the task panel on the right (desktop).
- A built-in view is the component `apps/web/src/views/<id>/View.vue`, found via `import.meta.glob('../views/*/View.vue')` (lazy chunks); `id` = `list` (default), `board`. No file - the view is not shown in the tabs. Module views - `useExtensions('views')`, `view` = `<moduleId>:<id>`.
- The task panel - `apps/web/src/task/TaskPanel.vue` (WB-6), via `import.meta.glob('../task/TaskPanel.vue')`; no file - the panel does not open. Props `{ taskKey: string; mode: 'panel' \| 'page' }`, event `close`. `/t/:key` (`TaskScreen.vue`) shows it with `mode: 'page'`.

### Exports `apps/web/src/views/index.ts`
| Name | Signature | Behavior |
|---|---|---|
| `ViewProps` | type `{ projectId: string; options: ViewOptions; filter?: Filter \| null }` | props of every `View.vue` and module view; a view shows only tasks where `matchFilter` = true |
| `ViewOptions` | type `{ groupBy: GroupBy; sortBy: SortBy; sortDir: 'asc' \| 'desc'; showSubtasks: boolean; fields: TaskField[] }` | `GroupBy`, `SortBy` - C-tasks; `fields` - visible fields of a list row (board - cards) |
| `TaskField` | type `'status' \| 'assignee' \| 'priority' \| 'dueDate' \| 'labels' \| 'project'` | |
| `Filter` | type `{ op: 'and' \| 'or'; rules: FilterRule[] }` | one level; empty `rules` - all tasks; stored in `savedViews.filter` as is |
| `FilterRule` | type `{ field: 'status' \| 'statusCategory' \| 'assignee' \| 'priority' \| 'label' \| 'dueDate' \| 'title' \| 'createdBy'; operator: 'in' \| 'notIn' \| 'isEmpty' \| 'isNotEmpty' \| 'before' \| 'after' \| 'contains'; value?: string[] \| number[] \| string }` | `in`/`notIn` - an array of ids (priority - numbers, `statusCategory` - categories); `before`/`after` - `YYYY-MM-DD` or `today`, `today+N`, `today-N`; `contains` - case-insensitive substring; the value `'me'` in `assignee`/`createdBy` - the current user |
| `useViewOptions` | `(projectId: MaybeRefOrGetter<string>, view: MaybeRefOrGetter<string>) => Ref<ViewOptions>` | default `{groupBy: 'status', sortBy: 'rank', sortDir: 'asc', showSubtasks: false, fields: ['status', 'assignee', 'priority', 'dueDate', 'labels']}`; stored in `localStorage['planar.view.<projectId>.<view>']` (try/catch) |
| `useSelection` | `() => { selected: Readonly<Ref<ReadonlySet<string>>>; set(ids: string[]): void; toggle(id: string): void; range(ids: string[], toId: string): void; clear(): void; anchor: Readonly<Ref<string \| null>> }` | one state per app; `range` - from `anchor` to `toId` in the order of `ids` (Shift); changing the project - `clear()` |
| `openTask` | `(key: string) => void` | desktop - `?task=<key>` on the current project route, mobile or outside a project - `/t/<key>` |
| `closeTask` | `() => void` | removes `?task` |
| `matchFilter` | `(task: TaskView, filter: Filter \| null \| undefined, ctx: { statuses: Row<'statuses'>[]; userId: string; today: string }) => boolean` | pure; `null`/empty `rules` -> true; `and` - all rules, `or` - at least one; `isEmpty` on `assignee`/`label` - no links, on `dueDate` - `null` |

### Saved view (`savedViews`)
`layout` - the view id (`list`, `board`, `<moduleId>:<id>`), `filter` - `Filter`, `config` - `ViewOptions`; unknown `config` fields are ignored, missing ones take defaults. Personal - `view.create` with `personal: true`; shared - `personal: false` (visible to all space members). The screen `/p/:projectId/v/:viewId` shows the view `layout` with `options = config` and `filter`; editing options on it changes a draft, "Save" - `view.update`.
