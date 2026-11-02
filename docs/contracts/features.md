---
type: contract
status: closed
module: features
updated: 2026-11-02
summary: features contracts — custom fields, task links, filters by fields, the "Table" and "Calendar" views
related: ["docs/plan/features.md", "docs/contracts/core.md", "docs/contracts/core-mutators.md", "docs/contracts/web.md"]
contracts: [{"id": "F-fields", "version": 1}, {"id": "F-links", "version": 1}, {"id": "F-filter", "version": 1}, {"id": "F-views", "version": 1}]
---

# features module contracts

Owner — the features coordinator. The entities `fieldDefs`, `taskLinks` and the format of `tasks.fields` are in `docs/contracts/core.md` (C-schema v6), mutators in `docs/contracts/core-mutators.md` (C-mutators v3), REST/MCP in `docs/contracts/core-api-v1.md` (C-http v8); they are checked by the core contract tests (`packages/shared/test/contract.test.ts`, `check-mutators.ts`, `apps/api/test/contract.schema.test.ts`). Here is what they do not cover. The web contracts (C-client, C-tasks, C-views) do not change: they are only extended at the points below.

## F-fields v1

### Values in `tasks.fields`
The key is `fieldDefs.id`; the value is never `null` (empty — no key).

| type | value | options |
|---|---|---|
| `text` | string of 1–5000 characters | `{}` |
| `number` | finite number | `{}` |
| `date` | `YYYY-MM-DD` | `{}` |
| `select` | `id` of one of `options.choices` | `{choices: {id: string 1–36, label: string 1–100, color?: string}[]}`, ids unique |
| `user` | user uuid (a `users` row exists) | `{}` |
| `url` | `http://` or `https://` URL, ≤ 2048 characters | `{}` |
| `money` | integer in minor units (kopecks, cents), \|v\| ≤ `Number.MAX_SAFE_INTEGER` | `{currency: /^[A-Z]{3}$/}` (ISO 4217), default `RUB` |

### Exports (`@planar/shared`, no Node API)
| Name | Signature | Behavior |
|---|---|---|
| `FIELD_TYPES` | `readonly ['text','number','date','select','user','url','money']` | order — for the type picker menu |
| `FieldType` | type `(typeof FIELD_TYPES)[number]` | |
| `fieldOptionsSchema` | `(type: FieldType) => ZodType` | schema of `options` per the table |
| `defaultFieldOptions` | `(type: FieldType) => Record<string, unknown>` | `select` — `{choices: []}`, `money` — `{currency: 'RUB'}`, otherwise `{}` |
| `fieldValueSchema` | `(def: {type: FieldType; options: Record<string, unknown>}) => ZodType` | value schema per the table (user existence is checked by the mutator) |

### Invariants
- A key without a definition in the task's project is not written (`invalid_args`); readers (views, REST, MCP) skip a key without a definition.
- `field.delete` and deleting a `select` choice clean the values in the project's tasks; changing a task's project resets `fields`.
- Money is shown as `Intl.NumberFormat(locale, {style: 'currency', currency}).format(v / 100)`; input — with a dot or comma, stored as `Math.round(x * 100)`.

### Web (`apps/web/src/fields/index.ts`, FT-1b)
| Name | Signature | Behavior |
|---|---|---|
| `useFieldDefs` | `(projectId: MaybeRefOrGetter<string>) => Readonly<Ref<Row<'fieldDefs'>[] \| undefined>>` | index `projectId`, by `rank` |
| `setTaskField` | `(taskId: string, fieldId: string, value: unknown) => Promise<void>` | `mutate('task.setField', …)`; `null` — remove |
| `formatFieldValue` | `(def: Row<'fieldDefs'>, value: unknown, ctx: {locale: string; users: Row<'users'>[]}) => string` | pure; no value or the choice was deleted — `''` |
| `FieldCell` | SFC: `def`, `value` | shows the value in a row/cell (read only) |
| `FieldEditor` | SFC: `def`, `value`, `spaceId`, event `update:value` (`unknown \| null`) | editor by type; `null` — clear; invalid input is not emitted |

## F-links v1

### Directions
A `taskLinks` row `{taskId: A, targetId: B, kind}` is visible from both sides:

| kind | from side A (`taskId`) | from side B (`targetId`) |
|---|---|---|
| `blocks` | `blocks` — blocks B | `blockedBy` — blocked by A |
| `relates` | `relates` | `relates` |
| `duplicates` | `duplicates` — a duplicate of B | `duplicatedBy` — B duplicates it |

`LinkSide = 'blocks' | 'blockedBy' | 'relates' | 'duplicates' | 'duplicatedBy'`. A task is **blocked** if there is a `blocks` row with `targetId` = it and the blocking task is not finished (`completedAt = null`).

### Web (`apps/web/src/links/index.ts`, FT-4a)
| Name | Signature | Behavior |
|---|---|---|
| `useTaskLinks` | `(taskId: MaybeRefOrGetter<string>) => Readonly<Ref<{id: string; side: LinkSide; otherId: string}[] \| undefined>>` | indexes `taskId` and `targetId`; by `side` in type order, then `otherId` |
| `useBlockedIds` | `(projectId: MaybeRefOrGetter<string>) => Readonly<Ref<ReadonlySet<string>>>` | ids of the project's tasks that are blocked (definition above); an empty set until read |
| `linkTasks` | `(taskId: string, otherId: string, side: LinkSide) => Promise<string>` | `blockedBy`/`duplicatedBy` — swaps the tasks and writes `blocks`/`duplicates`; `link.create` with a new id; returns the id |
| `unlinkTasks` | `(id: string) => Promise<void>` | `link.delete` |
| `BlockedIcon` | SFC without props | `lucide` icon `Ban` (or `OctagonX`) of the row icon size, with an `aria-label` from i18n `links.blocked` |

## F-filter v2 (extension of C-views `FilterRule`)

v2 (work, WK-0): `matchFilter` in `@planar/shared`, rule `cycle`, `ctx.cycles` — docs/contracts/work.md §F-filter v2.
- `FilterRule.field` additionally — `` `field:${fieldId}` ``; `value` additionally — `number`.
- Operators by field type: `text`, `url` — `contains`, `isEmpty`, `isNotEmpty`; `number`, `money` — `gte`, `lte` (`value: number`; for `money` — in minor units), `isEmpty`, `isNotEmpty`; `date` — `before`, `after` (`YYYY-MM-DD`, `today±N` as for `dueDate`), `isEmpty`, `isNotEmpty`; `select` — `in`, `notIn` (choice ids), `isEmpty`, `isNotEmpty`; `user` — `in`, `notIn` (uuid or `'me'`), `isEmpty`, `isNotEmpty`.
- `isEmpty` — the key is absent from `fields`. A rule on a field without a definition (deleted) is skipped (counts as satisfied). The operators `gte`/`lte` are allowed only for `field:` rules.
- `matchFilter` (`apps/web/src/views/filter.ts`) receives an optional `fieldDefs?: Row<'fieldDefs'>[]` in `ctx`; without it all `field:` rules are skipped. The signature of the other arguments does not change.

## F-views v2

v2 (work, WK-7): the Table layout in `savedViews.config.columns`, the Calendar's first day of the week — work.md §F-views v2.
- The built-in views `table` (FT-2) and `calendar` (FT-3) — `apps/web/src/views/table/View.vue`, `apps/web/src/views/calendar/View.vue`, props `ViewProps` (C-views); they show only tasks where `matchFilter` = true. Tabs are found by the existing glob; icons and order — `BUILTIN`/`ORDER` in `apps/web/src/views/index.ts`: `table: Table2`, `calendar: CalendarDays`, `ORDER = ['list', 'board', 'table', 'calendar']`; labels — i18n `views.table` (RU/EN labels "Table"), `views.calendar` (RU/EN labels "Calendar"). FT-3 edits them for both views.
- `savedViews.layout` — `table` or `calendar`, like any built-in view.
- Table: columns — the system `title`, `key`, `status`, `assignee`, `priority`, `dueDate`, `startDate`, `labels`, `createdAt`, `updatedAt` and `field:<fieldId>`; layout `{columns: {id: string; width: number}[]}` (order = array order, width in px 60–800) — `localStorage['planar.table.<projectId>']` (try/catch, unknown ids are skipped). Editing only through mutators: system fields via `updateTask`/`setAssignees`/`setLabels` (C-tasks), custom ones via `setTaskField`.
- Calendar: mode `month` | `week` — `localStorage['planar.calendar.<projectId>']`; the week starts on Monday. A task is shown from `startDate` to `dueDate`; with one date — on that day; with neither — in the side column "No date". Dragging onto a day shifts both dates by the same difference (duration is kept), from the side column — sets `dueDate`; one `updateTask` mutation per task. Mobile (`useBreakpoint().isMobile`) — a list by days.
- Dates are calendar `YYYY-MM-DD` without a time zone. "Today" — `localToday()` from `apps/web/src/views/filter.ts`. A date from `Date` — only by local components (`getFullYear/getMonth/getDate`), not `toISOString()`; adding days — via `new Date(y, m, d + n)`.
