---
type: reference
status: closed
module: work
updated: 2026-11-02
summary: Work contracts — C-modules v3, C-schema v7, F-filter v2, modules time, sprints, automations, webhooks, import, REST/MCP
related: ["docs/contracts/core.md", "docs/contracts/core-mutators.md", "docs/contracts/core-api-v1.md", "docs/contracts/web.md", "docs/contracts/features.md", "docs/plan/work.md"]
---

# Contracts of the work module

Owner — the work coordinator. Consumers: WK-* executors, the collab module (C-modules v3). Contract test — `apps/api/test/work-contract.test.ts`: the entities (`#### …` in the C-schema format) and mutator names of each installed module are checked against this file; a module not yet in `installed.ts` is an `it.todo`. The same test checks the ` ```json example=… ` blocks. The test finds the module sections by their headings `## Module <id> …`, so those headings stay as they are.

Modules: `time` (WK-1), `sprints` (WK-2), `automations` (WK-3), `webhooks` (WK-4), `import` (WK-6) — directories `modules/<id>/` per C-modules, package `@planar/module-<id>`, a line in `apps/api/src/modules/installed.ts`. Mutator names are `<id>.<action>`, entity names are `<id>` + a camelCase name, server tables are `<id>_…`.

System user (WK-0): a `users` row with `login = 'automation'`, `name` = the Russian word for "Automation", `role = 'member'`, `deactivatedAt` set (cannot sign in, not shown in people pickers), no password. Created idempotently at API start. Automations and module crons act on its behalf.

## C-modules v3 (WK-0)

v3: server hook `afterMutation`, module background jobs (pg-boss), running mutations as the system, web points `nav` and `topbar`. The rest is as in v2 (`docs/contracts/core.md` §C-modules).

### Server
Types without Node API — `packages/shared/src/contract/modules.ts`:
```ts
export interface MutationWrite {
  entity: string; op: 'put' | 'del';
  before: Record<string, unknown> | null;  // row before (wire), null — there was none
  after: Record<string, unknown> | null;   // row after, null — deleted
}
export interface MutationOrigin { ruleId?: string; aiRunId?: string; depth: number } // the mutation was made by an automation rule or an AI run (PLNRAPP-166)
export interface AfterMutationCtx {
  userId: string; now: string; tokenId: string | null;
  mutator: string;                // mutator name
  system: boolean;                // executed by the system (bypasses permissions)
  origin: MutationOrigin | null;
}
export interface BackendModuleManifest {
  /* … v2 … */
  afterMutation?: (writes: MutationWrite[], ctx: AfterMutationCtx, api: never /* ModuleHookApi; never — so a module with a typed api is assignable under strictFunctionTypes */) => Promise<void>;
  jobs?: unknown[];               // JobDef[]
}
```
Types with Node API — `apps/api/src/modules/hooks.ts` (exported for modules as `@planar/api/modules`, `exports["./modules"]` in `apps/api/package.json`):
```ts
export interface JobOpts {
  startAfter?: number /* sec */ | Date; singletonKey?: string;
  upsert?: boolean; // PLNRAPP-166: with singletonKey — pg-boss upsert: a queued job with the key gets new data and startAfter instead of a second job (debounce)
}
export interface ModuleHookApi {
  q: Q;                 // mutation transaction (inside the hook savepoint)
  sys: ServerTx;        // system write: bypasses permissions, lands in changes
  enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>; // pg-boss send in the same transaction (db option)
}
export interface JobApi {
  db: Db;
  /** mutations in one transaction, like executeMutations; system — bypasses permissions on behalf of userId */
  execute(userId: string, muts: { name: string; args: unknown }[],
          opts?: { system?: boolean; origin?: MutationOrigin | null }): Promise<void>;
  enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>; // outside a transaction
  systemUserId: string; // id of the "Automation" user
}
export interface JobDef<D = Record<string, unknown>> {
  queue: string;        // `<moduleId>.<name>`
  handler(data: D, api: JobApi): Promise<void>; // throw → retry per retry*
  cron?: string;        // pg-boss schedule, UTC; data = {}
  retryLimit?: number; retryDelay?: number; retryBackoff?: boolean; expireInSeconds?: number;
  localConcurrency?: number; // default 1
}
```
Rules:
- `runMutation` (`apps/api/src/sync/mutate.ts`): `run` → notifications hook → `afterMutation` of every **enabled** module in `installed` order → `finish()`. `writes` are the writes of the mutation itself (`ServerTx.writes`), without hook writes; hook writes do not call hooks.
- A module hook runs inside a savepoint (Drizzle `tx.transaction`). Hook error → the savepoint rolls back, `log.error`, and the mutation continues and commits.
- `enqueue` from a hook is in the same transaction: if the mutation rolls back, there is no job; the job sees committed data.
- One `PgBoss` per process (shared with push, `apps/api/src/jobs/jobs.ts`): at start the queues of all `jobs` of installed modules, workers and schedules (`cron`) are created. Disabled module: the worker takes the job and finishes it without calling `handler`.
- `push.boss: false` (the test default) — `enqueue` does nothing, there are no workers. Tests of module jobs start the app with `push: {boss: true}`.
- `executeMutations(db, userId, muts, queue?, tokenId?, opts?: {system?, origin?})` — `system: true` → `ServerTx.asSystem` with `ctx.userId = userId`; `activity.actorId`, notifications and `changes` work as usual.
- A module that needs `Db` gets it from the Nest provider `DB` (`apps/api/src/tokens.ts`, global).

### Web
`EXTENSION_KINDS` += `'nav'`, `'topbar'` (`FrontendModuleManifest` in shared — the same fields `nav?`, `topbar?`):
```ts
type NavItemDef = { id: string; order?: number } & (
  | { label: LocalizedText; icon: Component; to: string /* /m/<moduleId>/… */ }   // link
  | { section: Lazy<{}> }                                                         // section: its own component (channel list, document tree)
);
interface TopbarItemDef { id: string; component: Lazy<{}>; order?: number }
```
- `nav` — items in `Sidebar.vue` after the built-in ones ("Inbox", "My tasks"), ordered by `order`, then by key: a link is a menu item, a `section` is a whole component (lazy, `defineAsyncComponent`; it draws its own heading and content; a section load error does not break the sidebar). `nav` items are not shown on mobile. `to` outside `/m/<moduleId>/`, or neither `to` nor `section` → `registerModules` throws `Error`.
- `topbar` — components in `TopBar.vue` to the left of the user menu, ordered by `order`; desktop and mobile.

## C-modules v4 (WK-10)
v4: modules get the package `@planar/server-kit` (server) and the SDK `@planar/web/modules` (web) instead of importing the core by relative paths; the sync client knows module entities and mutators. v3 is unchanged.

### Server: `packages/server-kit` → `@planar/server-kit`
Dependencies — only `@planar/shared`, `drizzle-orm`, `@nestjs/common`, `zod` (no `@planar/api`: modules and api depend on kit, so there is no cycle). Modules use `"@planar/server-kit": "workspace:*"`; importing `@planar/api` from modules is forbidden.
```ts
export type Db = NodePgDatabase<Record<string, unknown>>;            // drizzle-orm/node-postgres
export type Q = PgDatabase<NodePgQueryResultHKT, Record<string, unknown>>;
export type { ModuleHookApi, JobApi, JobDef, JobOpts } from './hooks';  // moved from apps/api/src/modules/hooks.ts; ModuleHookApi.sys: Tx (@planar/shared)
// JobApi.execute opts += prepare?: (q: Q) => Promise<boolean | void> — in the same transaction before the mutations (locks, checks); false → the mutations are not executed
// JobApi.execute opts += after?: (q: Q, enqueue: ModuleHookApi['enqueue']) => Promise<void> — in the same transaction after all mutations; enqueue — in it as well; an error rolls the transaction back and is rethrown from execute (additive, C-modules v8, PL-2)
export class HttpError extends HttpException { constructor(status: number, code: string, message: string) } // C-http "Errors" format; the api ErrorFilter understands it
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T>; // 400 invalid_request
export interface AuthCtx { userId: string; role: 'owner' | 'admin' | 'member' | 'guest'; tokenId: string | null; tokenScope: 'read' | 'write' | null }
export interface CoreServices {
  db: Db;
  auth(req: object): AuthCtx;                       // like getAuth in api; not signed in → 401
  requireInstanceAdmin(req: object, opts?: { sessionOnly?: boolean }): AuthCtx; // not owner/admin → 403; sessionOnly and Bearer → 403
  toV1Tasks(q: Q | Db, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]>; // tasks rows → REST v1 shape (key, assigneeIds, labelIds)
  systemUserId(): string;
}
export const CORE = Symbol.for('planar.core');      // global Nest provider holding CoreServices; in a module: @Inject(CORE) core: CoreServices
```
`apps/api` implements `CoreServices` and re-exports the kit types where they used to be (`@planar/api/modules` remains a re-export for backward compatibility of the core; modules use only kit).

### Web: SDK `@planar/web/modules`
`exports["./modules"]` → `apps/web/src/modules/sdk.ts`: everything previously in `types.ts` (`defineWebModule`, item types) and, for modules —
`db` (PlanarDB), `useQuery`, `mutate(name, args)` (calls a mutator by name through the sync client), `useSession()` (the current user), `useTask`/`useProjectTasks`/dictionaries (C-tasks), `openTask`, the base components of `apps/web/src/ui` (C-ui), `useI18n`, `useWeekStart`, `localToday`, `matchFilter`. Modules import web only from here. The web typecheck (`vue-tsc`) includes `modules/*/web/**`; Tailwind scans `modules/*/web/**`.

### Sync client
- `apps/web/src/sync`: the Dexie schema = core + `entities` of all installed modules (`import.meta.glob('…/modules/*/shared/index.ts', {eager: true})` — shared manifests without Node API, small). A new or changed module entity → the Dexie schema version grows deterministically; the user's database is upgraded without manual clearing (if incompatible — recreated and bootstrapped).
- `apps/web/src/session.ts` registers the mutators of the core and of all modules (the server rejects a mutator of a disabled module with `unknown_mutator`).
- The initial JS budget (≤ 200 KB gzip) is kept: the initial chunk includes only the shared manifests of modules, web parts are lazy.

### Week (WK-0, consumers WK-1, WK-7)
`apps/web/src/i18n/week.ts`: `useWeekStart(): Readonly<Ref<0 | 1>>` (0 — Sunday, 1 — Monday) and `setWeekStart(v: 'auto' | 0 | 1)`. The value is `localStorage['planar.weekStart']` (`'auto'|'0'|'1'`, try/catch); `auto` and empty follow the i18n locale: `en` → 0, `ru` → 1.

## C-schema v7 (WK-0)
Change to `tasks` (docs/contracts/core.md §C-schema): field `cycleId` uuid? — a cycle of the `sprints` module, no FK; index `cycleId` (DB and Dexie, `indexes: spaceId, projectId, parentId, statusId, cycleId`). Core: `task.create` — `cycleId = null`; changing `projectId` in `task.update` → `cycleId = null`; `task.update` does not accept `cycleId` (only `sprints.setTask` sets it). REST v1 `task` includes `cycleId` (a `tasks` column).

## F-filter v2 (WK-0)
- `matchFilter`, `Filter`, `FilterRule`, `FilterCtx`, `FIELD_OPERATORS`, `resolveDate` — in `packages/shared/src/filter.ts` (exported from `@planar/shared`), without Vue and DOM; `apps/web/src/views/filter.ts` re-exports them (the signatures of C-views/F-filter v1 do not change). Task type — `FilterTask = Row<'tasks'> & { assigneeIds: string[]; labelIds: string[] }` (web `TaskView` is compatible with it).
- `FilterRule.field` += `'cycle'`: operators `in`, `notIn` (cycle ids or `'current'`), `isEmpty`, `isNotEmpty` (`cycleId` null).
- `FilterCtx` += `cycles?: { id: string; projectId: string; startDate: string; endDate: string; closedAt: string | null }[]`. A project's current cycle is the one with `closedAt = null` and `startDate ≤ today ≤ endDate`; `'current'` matches if the task's `cycleId` is the current cycle of its project. Without `cycles`, rules with `'current'` are skipped.
- `FilterCtx` += `forMe?: Set<string>` (PLNRAPP-140) — ids of tasks with an open comment or checklist item assigned to `userId`; an `assignee` rule with `userId` (`'me'`) counts such a task as assigned to them. Without `forMe` — only the task's assignees. Web views and saved views pass it.
- Web (WK-0): views and saved views pass `cycles` from the Dexie table `sprintsCycles` if it exists (the module is enabled).

## F-views v2 (WK-7)
Changes to F-views v1 (docs/contracts/features.md) and C-views:
- `ViewOptions` += `columns?: { id: string; width: number }[]` — the Table layout (order = array order, width 60–800 px, an id absent from the array means the column is hidden; unknown ids are skipped). Stored in `savedViews.config.columns` with the other options.
- The Table takes its layout from `options.columns` if set; otherwise from `localStorage['planar.table.<projectId>']` (fallback, v1 format); otherwise the default. Editing width, order or visibility: on a saved view, it changes the options draft (`columns`) and "Save" runs `view.update`; on a project tab without a saved view, it goes to localStorage, as in v1. "Save as view" from the Table puts the current layout into `config.columns`.
- Calendar: the first day of the week is `useWeekStart()` (§Week), not always Monday; the profile (`/profile`) has a choice "Auto / Monday / Sunday" (`setWeekStart`).

## Module time (WK-1)

#### timeEntries
scope: space · write: member · bootstrap: yes · indexes: spaceId, taskId, userId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | from the task |
| `taskId` | uuid | no FK; on task deletion the module hook deletes the entries (`sys.del`) |
| `userId` | uuid | = ctx.userId; only the owner edits and deletes |
| `startedAt` | ts | |
| `endedAt` | ts? | null — the timer is running |
| `durationSec` | int? | null while running; otherwise seconds ≥ 0 |
| `note` | text? | ≤ 1000 |
| `source` | enum(timer,manual) | |
| `billable` | bool | default false (PLNRAPP-145) |
| `createdAt` | ts | |
| `updatedAt` | ts | |

DB: partial unique index `(user_id) where ended_at is null` — one running timer per user (violation → `conflict`).

#### timeEstimates
scope: space · write: member · bootstrap: yes · indexes: taskId

| field | type | note |
|---|---|---|
| `id` | uuid | = `taskId` |
| `spaceId` | uuid | |
| `taskId` | uuid | no FK; deleted with the task by the module hook |
| `minutes` | int | 1–100000 |
| `updatedBy` | uuid | |
| `updatedAt` | ts | |

| mutator | args | rules |
|---|---|---|
| `time.start` | `id, taskId` | running entries of ctx.userId are stopped (`endedAt = ctx.now`, `durationSec`); the new one: `startedAt = ctx.now`, `source = timer` |
| `time.stop` | `id` | own only; already stopped — nothing; `endedAt = ctx.now`, `durationSec = floor((endedAt − startedAt)/1000)` |
| `time.log` | `id, taskId, startedAt, durationSec, note?, billable?` | `durationSec` 1–86400; `endedAt = startedAt + durationSec`; `source = manual` |
| `time.update` | `id, startedAt?, endedAt?, durationSec?, note?, billable?` | own only; `durationSec` given → `endedAt = startedAt + durationSec`, otherwise recomputed from `startedAt`/`endedAt`; `endedAt < startedAt` → `invalid_args`; for a running entry — only `startedAt`, `note` |
| `time.delete` | `id` | own only |
| `time.setEstimate` | `taskId, minutes: int\|null` | `null` — delete; `updatedBy = ctx.userId` |

- The server computes durations: the server run of a mutator recomputes `startedAt`/`endedAt`/`durationSec` from the server `ctx.now`; the client's estimate is overwritten by sync.
- Two devices: in a race of two `time.start` calls the second gets `conflict` from the index; the client shows the timer that came from the server.
- The total on a task = own entries + entries of all subtasks (recursively); a running timer is `now − startedAt` on the client.
- Web: `taskPanels` `time:timer` (`property: true` — a properties row since PLANARAPP-42: start/stop and my tracked time of the task; a click on the time opens a menu with the total incl. subtasks, estimate vs. actual, the manual-entry form — duration as `Xm|h|d|w` with 1d = 8h, 1w = 5d, date, note ≤ 200, billable — and the task's entries of every user: user, date, duration, billable, note hint; own ones are edited in the same form and deleted), `topbar` `time:timer` (the running timer ticks locally, stop), `nav` `time:week` → `/m/time/week` ("My hours": a day × task table for the current user, week with `useWeekStart()`; editing a cell sets the new total for the day: the difference is added with `time.log` or removed by editing/deleting the day's manual entries; 0 — delete the day's entries; "Export CSV" (PLNRAPP-149) — completed entries for a period, from the replica: start as a local timestamp `YYYY-MM-DD HH:MM:SS`, project, task, user name, login, minutes, comment, billed; instance admins pick the people, everyone else gets own entries).

## Module sprints (WK-2)

#### sprintsSettings
scope: space · write: member · bootstrap: yes · indexes: projectId

| field | type | note |
|---|---|---|
| `id` | uuid | = `projectId` |
| `spaceId` | uuid | |
| `projectId` | uuid | |
| `enabled` | bool | |
| `lengthDays` | int | 1–60, default 14 |
| `timezone` | text | IANA (`Europe/Moscow`); by default the browser time zone at enabling |
| `autoCreate` | bool | create the next cycle on close; default true |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### sprintsCycles
scope: space · write: member · bootstrap: yes · indexes: spaceId, projectId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `projectId` | uuid | |
| `number` | int | 1, 2, …; unique (projectId, number); the mutator sets max + 1 |
| `name` | text? | ≤ 100 |
| `startDate` | date | |
| `endDate` | date | inclusive, ≥ `startDate` |
| `closedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Cycles of a project do not overlap in dates (violation → `conflict`).

| mutator | args | rules |
|---|---|---|
| `sprints.configure` | `projectId, enabled?, lengthDays?, timezone?, autoCreate?` | put `sprintsSettings` (id = projectId); invalid `timezone` (`Intl.DateTimeFormat` throws) → `invalid_args` |
| `sprints.create` | `id, projectId, startDate, endDate?, name?` | `endDate` defaults to `startDate + lengthDays − 1` |
| `sprints.update` | `id, name?, startDate?, endDate?` | closed → `conflict` |
| `sprints.delete` | `id` | tasks with `cycleId = id` get `cycleId = null` |
| `sprints.setTask` | `taskId, cycleId: uuid\|null` | the cycle must belong to the task's project and not be closed, otherwise `invalid_args` |
| `sprints.close` | `id, nextId` | already closed — nothing; `closedAt = ctx.now`; tasks with `cycleId = id` not in category done/cancelled move to the next cycle: the nearest unclosed one with `startDate > endDate`, otherwise, with `autoCreate`, a new one `nextId` with `startDate = endDate + 1` and length `lengthDays`; otherwise `cycleId = null` |

- Cron `sprints.close-due` (every 10 min): unclosed cycles with `endDate < today` in the project's `timezone` → `sprints.close` as the system user, one pg-boss job per cycle (`singletonKey = cycleId`); the cycle row is locked (`select … for update`) until the mutator runs. The carry-over happens exactly once (job retry, two workers, a manual close at the same time).
- Web: view `sprints:sprint` (project tab): current cycle, progress by status categories, burn-up (axis — cycle days; scope — the number of tasks in the cycle now; done — cycle tasks with `completedAt` ≤ the day), a "Close" button; the project's sprint settings are in the same view; the "Sprint" field in the task panel (`taskPanels` `sprints:cycle`); in the filter builder — the "Sprint" rule (`cycle`, option "Current").

## Module automations (WK-3)

#### automationsRules
scope: space · write: member · bootstrap: yes · indexes: spaceId, projectId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `projectId` | uuid | the rule fires on tasks of this project |
| `name` | text | 1–100 |
| `description` | text? | 0–2000, `null` by default (PLNRAPP-166) |
| `enabled` | bool | |
| `trigger` | obj | `{type, …parameters}` — catalog below |
| `conditions` | obj | `Filter` (F-filter v2), `{op:'and', rules:[]}` — always |
| `actions` | json | array of 1–10 actions, catalog below |
| `createdBy` | uuid | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

| mutator | args | rules |
|---|---|---|
| `automations.create` | `id, projectId, name, description?, trigger, conditions?, actions, enabled?` | schemas `triggerSchema`, `actionSchema`, `filterSchema` (exported from `modules/automations/shared`); invalid → `invalid_args`; `enabled` defaults to true |
| `automations.update` | `id, name?, description?, trigger?, conditions?, actions?, enabled?` | |
| `automations.delete` | `id` | |

### Triggers
| `type` | parameters | fires |
|---|---|---|
| `task.created` | — | `tasks` put, `before = null` |
| `task.status_changed` | `from?: uuid[]`, `to?: uuid[]` | `statusId` changed; if `from`/`to` are given — the old/new value is in the list |
| `task.assignee_changed` | `userIds?: uuid[]`, `userId?: uuid` (rules before PLNRAPP-197) | `taskAssignees` put (new) or del; with `userIds`/`userId` — only adding one of these users, whatever other assignees the task has |
| `task.field_changed` | `field: 'title'\|'description'\|'priority'\|'dueDate'\|'startDate'\|'parentId'\|'field:<uuid>'`, `byHuman?: bool` | the field value changed (`fields[id]` for `field:`) |
| `task.due` | `daysBefore: int 0–30` | cron `automations.due` (hourly): the task is not done/cancelled, `dueDate − daysBefore ≤ today` in `settings.timezone` (instance key, IANA, default `UTC`); once per (rule, task, `dueDate`) |
| `comment.added` | `byHuman?: bool` | `comments` put, `before = null` |
| `task.stale` | `days: int 1–365`, `statuses?: uuid[]` | cron `automations.due`: `updatedAt ≤ now − days`; with non-empty `statuses` — the task's status is in the list; slot `updatedAt` |
| `task.unassigned` | `hours: int 1–720` | cron `automations.due`: no assignees since `max(createdAt, last activity assignee_removed) ≤ now − hours`; slot — that moment |
| `task.waiting_human` | `days: int 1–365` | cron `automations.due`: an unresolved comment assigned to an active user, created `≤ now − days`; slot — id of the oldest such comment |
| `task.start_reached` | — | cron `automations.due`: `startDate ≤ today` in `settings.timezone`; slot `startDate` |
| `mr.pipeline` | `mr: 'opened'\|'merged'`, `pipeline: ('success'\|'failed'\|'canceled'\|'skipped'\|'manual')[]` (≥ 1) | `gitlabMrs` put (module gitlab, PLNRAPP-205) where `pipelineStatus` is not null and the pair (`state`, `pipelineStatus`) changed: `state = mr`, `pipelineStatus` in `pipeline`. `opened` — the MR's head pipeline (CI of the MR); `merged` — the target branch pipeline with the merge (deploy), `skipped` — none 10 min after the merge |
| `schedule` | `cron` (5 fields: `*`, numbers, ranges, steps, lists), `tz?` (IANA; default `settings.timezone`) | cron `automations.schedule` (every minute): the latest cron occurrence in `tz` is within the last 2 minutes → runs for every open task of the project; slot — the occurrence (ISO). A field out of range passes the shape check, and the rule never fires |

The rule's project is the task's `projectId` after the mutation. Deleted tasks do not trigger rules.

`byHuman: true` (PLNRAPP-166) — the event counts only when a person made it: `!ctx.system && !ctx.origin` and the author is not deactivated (until `users.bot` of PLNRAPP-167, a deactivated author stands for a bot). A personal API token counts as its owner. On other triggers the key is dropped by the schema.

Scanned triggers (`stale`, `unassigned`, `waiting_human`, `start_reached`, `schedule`) look at tasks that are not archived and not done/cancelled, in projects with the module on; the four hourly ones are counted by one query over all rules. Each fires once per (rule, task, slot): the slot changes when the condition resets (the task is updated, assigned and unassigned again, a new start date), and then the trigger can fire again.

### Conditions and actions
Conditions — `matchFilter(task, conditions, {statuses, fieldDefs, userId: system, today})` on the task's current row at execution time; not met → the run is `skipped`.

| `type` | parameters | mutator |
|---|---|---|
| `set_status` | `statusId` | `task.update` |
| `assign` | `userId` | `task.assign` |
| `unassign` | `userId` | `task.unassign` |
| `add_label` | `labelId` | `task.addLabel` |
| `remove_label` | `labelId` | `task.removeLabel` |
| `set_field` | `field: 'priority'\|'dueDate'\|'startDate'\|'field:<uuid>'`, `value` | `task.update` / `task.setField`; dates — `YYYY-MM-DD`, `today±N` or `null` |
| `add_comment` | `text` 1–5000 | `comment.create` (`textToDoc`) |
| `move_to_project` | `projectId`, `statusId?` | `task.update` |
| `create_subtask` | `title` 1–500 | `task.create` with `parentId`; status — the first by `rank` in category todo, otherwise backlog |
| `send_webhook` | `subscriptionId` | `enqueueWebhookEvent` of the webhooks module, event `automation.fired` |
| `ai_run` | `aiActionId` (an `aiActions` row of the rule's project), `maxRuns?: int 1–20` (PLNRAPP-205: runs of the action by this rule on the task in a row — since the last run of the action by another rule / by hand / a restart / with questions to a person; at the limit the run asks the task's person instead, as on an exhausted budget) | none: after the other actions, in their transaction, `enqueue('ai.run', {kind: 'action', taskId, actionId, ruleId, statusId, parentRunId}, {singletonKey: 'taskId:actionId', upsert: true, startAfter: 60})` — debounce; the module ai runs it (PLNRAPP-168) |

A rule with `ai_run` (in its old or new actions) is created, changed and deleted only by an admin of the project (`needProjectAdmin`); otherwise `forbidden`.

### Execution
- Hook `afterMutation`: by `writes` — matching enabled rules → `enqueue('automations.run', {ruleId, taskId, depth, eventAt, aiRunId?})`, `depth = (ctx.origin?.depth ?? 0) + 1`; `aiRunId` — `ctx.origin.aiRunId` (the change is an AI run's: a run it starts continues the chain). Not enqueued if `depth > 3` or `ruleId = ctx.origin.ruleId` (a rule does not fire on its own action).
- Worker `automations.run`: rule disabled/deleted or task gone — `skipped`; otherwise all actions in one transaction `JobApi.execute(systemUserId, muts, {system: true, origin: {ruleId, depth}})`. Error → actions roll back, the run is `error` with the text; the original mutation is not affected. No retries (`retryLimit: 0`).
- Server tables: `automations_runs` (`id uuid pk`, `rule_id uuid`, `task_id uuid`, `depth int`, `status text check (ok,skipped,error)`, `error text?`, `created_at`; index `(rule_id, created_at desc)`; cron deletes rows older than 30 days), `automations_due_fired` (`rule_id`, `task_id`, `due_date date`; pk of all three), `automations_fired` (PLNRAPP-166: `rule_id`, `task_id`, `slot text`, `created_at`; pk of the first three; the daily cron deletes rows of deleted rules and tasks and `schedule` rows older than 30 days).
- REST: `GET /api/automations/rules/:id/runs?limit=` (1–200, default 50) → `{data: run[]}` newest first; rule not visible → 404. `run` = `{id, ruleId, taskId, depth, status, error, createdAt}`.
- Web: settings page `automations:rules` (project picker, rule list, builder "trigger → conditions (filter builder) → actions", run log).

## Module webhooks (WK-4)
No synced entities (the secret must not reach the client). Server tables:
- `webhooks_subscriptions`: `id uuid pk`, `url text`, `events text[]`, `secret text`, `active bool`, `description text?`, `created_by uuid`, `created_at`, `updated_at`.
- `webhooks_deliveries`: `id uuid pk` (= `X-Planar-Delivery`), `subscription_id uuid` (`on delete cascade`), `event text`, `payload jsonb`, `status text check (pending,ok,failed)`, `attempts int`, `next_attempt_at timestamptz?`, `last_status int?`, `last_error text?`, `created_at`, `updated_at`; index `(subscription_id, created_at desc)`.

REST — only `users.role` ∈ {owner, admin}, otherwise 403; Bearer → 403 (as for `/api/tokens`). `subscription` — without `secret`.

| method and path | input → output |
|---|---|
| `GET /api/webhooks/subscriptions` | → `{data: subscription[]}` |
| `POST /api/webhooks/subscriptions` | `{url, events: string[] (≥1), description?}` → `201 {data, secret}` |
| `PATCH /api/webhooks/subscriptions/:id` | `{url?, events?, active?, description?}` → `{data}` |
| `POST /api/webhooks/subscriptions/:id/rotate-secret` | → `{secret}` |
| `DELETE /api/webhooks/subscriptions/:id` | → `204` |
| `POST /api/webhooks/subscriptions/:id/ping` | → `202 {data: delivery}` (event `ping`) |
| `GET /api/webhooks/subscriptions/:id/deliveries?limit=&cursor=` | → `{data: delivery[], nextCursor}` newest first |
| `POST /api/webhooks/deliveries/:id/redeliver` | → `202 {data: delivery}` — a new delivery with the same `payload` (new `id`) |

`url` — `http:`/`https:`, no userinfo, ≤ 2000; otherwise 400. `secret` — `whsec_` + 32 random bytes in base62.

### Events
`task.created`, `task.updated`, `task.deleted`, `comment.created` — from the `afterMutation` hook (one event per task per mutation; `task.updated` — changes to the `tasks` row, assignees, labels); `ping`; `automation.fired` — only by the `send_webhook` action into the given subscription (it need not be in the subscription's `events`; the subscription must be `active`).

Body — `{id, event, createdAt, data}`, UTF-8, `JSON.stringify`; exactly the bytes that were sent are signed.
- `task.created`, `task.updated`: `data = {task, changes, actorId}` — `task` in the REST v1 shape, `changes` — `{<field>: [old, new]}` (as `activity.changes`; `assigneeIds`, `labelIds` are arrays), for `created` — `{}`;
- `task.deleted`: `data = {task: {id, key, projectId, spaceId}, actorId}`;
- `comment.created`: `data = {task, comment: {id, taskId, authorId, text, createdAt}, actorId}` (`text` — the text of `body`);
- `automation.fired`: `data = {ruleId, task}`; `ping`: `data = {}`.

Export for automations — `@planar/module-webhooks/api`: `enqueueWebhookEvent(api: ModuleHookApi | JobApi, subscriptionId: string, event: string, data: object): Promise<void>`.

### Delivery
- Headers: `Content-Type: application/json`, `User-Agent: Planar-Webhooks/1`, `X-Planar-Event`, `X-Planar-Delivery`, `X-Planar-Signature: sha256=<hex HMAC-SHA256(secret, body)>` (the key is the whole `secret` string, UTF-8).
- pg-boss job `webhooks.deliver {deliveryId}`. Success — a 2xx response within ≤ 10 s (connection + response); otherwise the attempt fails. 3xx is a failure, redirects are not followed. The response body is not read: the connection is closed after the status.
- Retries: after failed attempt n (1–10) the next one comes after `60·2^(n−1)` s (1, 2, 4 … 512 min; 11 attempts over ≈ 17.1 h ≤ 24 h); after the 11th — `failed`. `next_attempt_at` is the time of the next attempt; a retry is a new job with `startAfter`.
- **SSRF:** before each attempt — DNS resolution, all addresses are checked; forbidden: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `224/4` and above, `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, IPv4-mapped (`::ffff:`) forms of forbidden ones. The connection goes to the checked address (`node:http`/`node:https` `request` with its own `lookup` that returns the checked address; no second resolution; SNI and `Host` — the original name). Forbidden address → `failed` at once, `last_error = 'blocked_address'`, no retries. Exceptions — env `WEBHOOKS_ALLOW_HOSTS` (comma-separated: host names or CIDR), for dev and e2e only.
- Web: settings page `webhooks:settings` (admin only): subscriptions, the secret is shown once, delivery log, "Redeliver", "Test" (ping).

Reference for signature verification (receiver, Node):
```js
import { createHmac, timingSafeEqual } from 'node:crypto';
const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
const ok = header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
```

```json example=webhook.signature
{"secret": "whsec_test", "body": "{\"id\":\"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6c01\",\"event\":\"ping\",\"createdAt\":\"2026-10-23T06:00:00.000Z\",\"data\":{}}", "signature": "sha256=a43c17381401da94222350b1503b6bcef9ff6ef41b99d0b29a8df25c68b0dac1"}
```

## Module import (WK-6)
Server tables:
- `import_jobs`: `id uuid pk`, `user_id uuid`, `project_id uuid`, `format text check (csv,trello)`, `preset text` (`clickup`, `jira`, `linear`, `custom`, `trello`), `status text check (pending,running,done,failed)`, `total int`, `processed int`, `created int`, `updated int`, `skipped jsonb` (`{row, reason}[]`), `warnings jsonb` (`{row, message}[]`), `error text?`, `created_at`, `updated_at`.
- `import_items`: `project_id uuid`, `preset text`, `external_id text`, `task_id uuid`, `updated_at`; pk `(project_id, preset, external_id)`.

| method and path | input → output |
|---|---|
| `POST /api/import/preview` | multipart: `file`, `format`, `preset` → `{columns: string[], rows: string[][] /* ≤ 20 */, mapping: Mapping /* suggestion for the preset */}` |
| `POST /api/import/jobs` | multipart: `file`, `projectId`, `format`, `preset`, `mapping` (JSON) → `202 {data: job}` |
| `GET /api/import/jobs/:id` | → `{data: job}`; someone else's → 404 |

- `Mapping` = `{externalId?, title, description?, status?, assignee?, labels?, dueDate?, startDate?, priority?, parent?}` — the CSV column name; `statusMap?: {<value>: statusId}` (unknown value — the default status, as in REST v1); `labels` — comma-separated, by name, missing ones are created with `label.create`; `assignee` — by email, then by login (case-insensitive), unknown — no assignee and a row in `warnings`; `parent` — the external ID of the parent in the same file; Trello JSON — fixed mapping (cards, lists → statuses, labels, members, checklists → `checklist.add`).
- Idempotency: a row with an `externalId` already in `import_items` updates the task (`task.update`, full replacement of assignees and labels) instead of creating a new one. Without `externalId` — always new.
- pg-boss job `import.run {jobId}`: as `user_id` (their permissions), in batches of 100 rows per transaction; `processed` grows after each batch. Skipped rows (no title, mutator error) go to `skipped` with a reason, the import continues.
- Limits: file ≤ 10 MB, ≤ 20 000 rows; larger → 400.
- References — `e2e/fixtures/import/` (`clickup.csv`, `jira.csv`, `linear.csv`, `trello.json`, `README.md` with the format source for each).
- Web: route `/m/import/` (wizard: file → format and preset → mapping and preview → progress and report), command `import:open`.

## REST and MCP (WK-5), C-modules v5
Moved to docs/contracts/work-api.md (document size).
