---
type: contract
status: closed
module: projects
updated: 2026-11-03
summary: Статусы и метки, модули, участники проекта; личный вид узла (C-schema v17, C-mutators v14)
related: ["docs/plan/projects.md", "docs/contracts/core.md", "docs/contracts/core-schema.md", "docs/contracts/core-mutators.md"]
contracts: [{"id": "C-schema", "version": 17}, {"id": "C-mutators", "version": 14}]
---

# Contracts of the module projects

Owner: the projects coordinator. Interfaces of the core live in `docs/contracts/core*.md` (already edited to C-schema v15, C-mutators v11 — the code must follow, the contract test breaks otherwise). Decisions: plan `docs/plan/projects.md` §2.

## PJ-1: statuses and labels belong to a project

**Schema (C-schema v15).** `statuses` and `labels` get `projectId uuid not null` (FK `projects.id`, on delete cascade; index `projectId`, kept index `spaceId`). `spaceId` stays (denormalized from the project, immutable) so that sync visibility and bootstrap by space do not change. `project.id` and `statuses.projectId` never change.

**Migration (one, number 0032).**
1. For every project P of space S: copy every status of S into P (new uuid, same name/category/color/rank) and every label of S into P.
2. `tasks.status_id` → the copy of its status in `tasks.project_id`; `task_labels.label_id` → the copy of its label in the task's project. Nothing is lost: a task with a status whose copy is missing is a bug (assert in the migration).
3. References from modules to statuses (gitlab `mergedStatusId` per project, automations rules `from/to/set status`, forms `status_id`, recurring, templates, goals, import mapping, saved views filters/config with status or label ids) are remapped through the same copy map to the project of the entity (rule/form/template has a project; where an entity has no project and refers to a space status — keep one rule per project of the space is NOT allowed; report `blocked` with the entity name instead of guessing).
4. Delete the original space-level statuses and labels (rows with `projectId` null cannot exist after the migration).
5. A space without projects: its statuses/labels are deleted (new projects get their own).
6. Delivery to clients: every created, re-pointed and deleted row of `statuses`, `labels`, `tasks`, `taskLabels` gets a `changes` row (`put`/`del`) in the same migration — or the migration bumps the epoch so that every client gets `reset` on the next pull. The executor picks one and writes the justification into the report; silent SQL without either is rejected.
7. Down path is not required; data check on a copy: tests with ≥ 2 spaces, ≥ 3 projects, shared labels and statuses, tasks with labels, module references.

**Mutators (C-mutators v11)** — table in `core-mutators.md`. Extra rules:
- `status.*`, `label.*`: write permission by the project's space (as before: statuses admin, labels member); exception (decided 2026-11-02): statuses of a project created in the same transaction (`project.create`, `templates.createProject`) are written without the admin check, so a member can create a project. `status.delete`: `replaceWith` must be of the same project; last status of the project → `conflict`.
- `task.create`: `statusId` and `labels[].labelId` belong to `projectId`, else `invalid_args`. `task.addLabel` — label of the task's project.
- `task.update` with `statusId`: the status belongs to the task's project (after the update, if `projectId` changes too), else `invalid_args`.
- `task.update` with a `projectId` change (same space): the status is remapped — same name (case-insensitive), else same category with the lowest rank, else the project's first status by rank; labels are remapped by name (case-insensitive), a label without a counterpart is dropped (`taskLabels` row deleted). An explicit `statusId` in the same call wins and is validated against the new project.
- `project.create` creates 5 statuses (`statusIds`, `statusNames`) or copies via `copyFrom`; `space.create` creates no statuses (args `statusIds`, `statusNames` removed).
- `project.copyDictionaries`: see the table; idempotent by name (skips existing).
- `project.delete`: after the tasks check, deletes the project's statuses and labels. `space.delete withContent`: unchanged in effect.
- Seeds (`apps/api/src/db/seed*.ts`) create statuses/labels per project.

**REST v1 and MCP.** Statuses/labels endpoints and tools are addressed by project (`projectId`); a list by `spaceId` returns the union over the space's projects with `projectId` in each item (read compatibility for tokens). Create takes `projectId`. Task payloads unchanged. `docs/contracts/core-api-v1.md` and `work-api.md` are updated by the executor in the same task if they mention statuses/labels (documentation of an already fixed interface; version not bumped here — note it in the report).

**Web in PJ-1.** Only mechanical fixes so that `pnpm typecheck` and web vitest stay green (use `projectId` where the mutators demand it, pick statuses/labels of the task's project). The UI sections «Статусы»/«Метки», summary lists and pickers are PJ-2. Interim UI behaviour on the branch is not a goal.

## PJ-3: modules per project (C-schema v16, C-mutators v12)

**Classes (decision 2026-11-02, plan §2.1).** Data modules: `gitlab, sprints, time, forms, recurring, automations, templates, goals, timeline, workload, dashboards, docs`. Shared modules (instance level): every other installed module (`chat, email, plugins, import, webhooks`, demo `hello`). The list lives in one place in shared (a constant `DATA_MODULE_IDS`), used by api and web.

**State.** Data modules: `projects.modules` (text[]; see core-schema). Shared modules: `settings.enabled_modules` as before, but it holds only shared ids (`settings.set` with a data id → `invalid_args`). A data module is installed on the instance always; whether it works in a project is `projects.modules`.

**Mutator** `project.setModule` — table in `core-mutators.md`. Disabling keeps the module's data (not deleted); enabling again restores it.

**Migration 0033** (one): add `projects.modules text[] not null default '{}'`; for every project (archived too) set `modules` = the data module ids that were in `settings.enabled_modules`; remove data ids from `enabled_modules`. Delivery to clients: `changes` row `put` for every changed project and the changed `settings` row — or an epoch bump (`reset`); pick one, justify in the report (as PJ-1). Test: ≥ 2 spaces, ≥ 3 projects, some data modules enabled, shared ones too.

**Server gating.** `ModuleGuard` (`apps/api/src/modules/module.guard.ts`) and `GET /api/modules` keep working for shared modules by `enabled_modules`. For a data module an operation addressed to a project (mutator with `projectId` or an entity of a project, REST/HTTP route with a project in the path/body/query) on a project where the module is off → HTTP `404 module_disabled` / mutator `conflict` with message `module_disabled`. Operations not addressed to a project (module-wide listings, webhooks/inbound endpoints of gitlab etc.) filter by project or keep working — the executor lists each in the report. `afterMutation` hooks and `jobs` (polling, recurring, automations) skip projects where the module is off. Bootstrap/sync visibility of module rows does not change (rows stay visible; the UI hides them).

**Web.** `enabledForProject(moduleId, projectId)` in `apps/web/src/modules/registry.ts` (reads `projects.modules` of the replica). Project-level module items (`taskPanels`, `views`, `groupTabs`, `settings` with `level: 'project'`/`'space'`, `commands`, `nav`, `search`, polling jobs of the module) render only if the module is enabled for the task's/current project; in space/folder/workspace summaries, items of a module show for the projects where it is enabled. Project settings: a section «Модули» (checkbox per data module, only project-space admin/instance admin can change; «Настроить» opens the module `setup` dialog as before). Shared modules: a separate page «Модули экземпляра» (route `/admin/modules`, instance admin only, link in the admin part of the main menu) with the current ModulesSettings logic restricted to shared modules; the section «Модули» is removed from Workspace settings. i18n ru/en for all new strings.

**Out of scope.** Moving module data between projects, per-space defaults, new modules.

## PJ-4: personal node view on the server

**Storage.** No new table: `savedViews` rows with `node` set (C-schema v14, text `w`, `s:<spaceId>`, `p:<projectId>`, folder node as the web already builds it, suffix `:me-<mode>` for «Моя работа»). Semantics: `userId` = caller → my personal view of (`node`, `layout`); `userId` null → the shared default of (`node`, `layout`), at most one. `spaceId` of the row — as the web already passes it today.

**Effective view** (web): my personal row, else the shared default, else built-in default. Applies to all nodes: project, folder, space, workspace, «Моя работа», for every built-in layout (`list`, `board`, `table`, `calendar`) and module views if they use the node view.

**Behaviour.**
- Any change of filter or view options (columns, grouping, sorting, view type) is saved at once to the caller's personal row: debounced ≤ 500 ms, `view.create` on first change then `view.update` (one row per node+layout; the client id is stable per node+layout while the row is unknown). No «draft» state, no «Save» button.
- «Сохранить для всех» (shown to members and above, `useCanShare`) → `view.setNodeDefault` with the current state; the caller's personal row of that node+layout is removed by the mutator, so the caller sees the new default.
- «Сбросить» (shown when a personal row exists) → `view.delete` of my personal row: the shared default (or built-in default) returns.
- Another user's or another browser's personal row is never visible (visibility `space|user` is unchanged). Reload and another device show the same personal view after sync.
- Named saved views (node null) are unchanged.

**Mutators** (table in core-mutators.md): `view.setNodeDefault` new; `view.create` with `node` stays personal only; `view.update/delete` unchanged (personal row — owner, `write: member|self`; a shared node default may be updated/deleted by a member of the space and above). No schema change, no migration.

**Out of scope.** Conflict resolution beyond «freshest row wins» (existing shortcut in `useNodeView`); per-device views.

## PJ-14: modules of a new project (C-mutators v13)

Data modules are always installed on the instance (PJ-3), so «enabled by the instance admin» means: every installed data module whose `unavailable` is null. `project.create` takes optional `modules: string[]` (data module ids) and stores it in `projects.modules` (default `[]`). Shared rule: every id must be a data module, otherwise `invalid_args`. Server tx: an id with `unavailable` ≠ null → `invalid_args` (as `project.setModule`). Web: the project creation flow passes all installed data modules that are available; the project can switch them off afterwards in project settings «Модули». No schema change, no migration; existing projects unchanged.

## PJ-11: project members (C-schema v17, C-mutators v14) — stage 1: server and sync

Decision Q1 (a), 2026-11-02: full hiding. A project has its own composition and roles, chosen only among the members of its space. A user removed from a project receives none of its data: sync (bootstrap, pull, WS), REST v1, MCP, files, search, activity, notifications, module routes. The versions v17/v14 are bumped by the executor in this contract's frontmatter, `core.md`, `core-schema.md`, `core-mutators.md` in the same commit as the code (contract test).

**Schema.** `projects.membersMode text not null default 'inherit'` (`inherit` | `custom`; replica rows without the field = `inherit`). New table `projectMembers` — scope: space · write: server (mutators only) · bootstrap: yes · indexes: projectId, userId; fields `id uuid` (unique (projectId, userId)), `spaceId` (denormalized, immutable), `projectId`, `userId`, `role enum(admin,member,guest)`, `createdAt`, `updatedAt`. Rows exist only while `membersMode = 'custom'`. Migration 0034: add the column (existing projects `inherit`), create the table; no data move; delivery — epoch bump (`reset`) or `changes` rows, justify in the report.

**Effective access.** `inherit`: the role from `spaceMembers`. `custom`: the role from `projectMembers`; no row → no access. Space admins and instance admins always keep access to every project of the space with the admin role (otherwise a hidden project cannot be managed) — an assumption of the coordinator, listed in the report. A `projectMembers` user must be a member of the space; removing a user from the space deletes their `projectMembers` rows in the same tx. A space guest cannot get a higher project role than guest (`invalid_args`).

**Mutators (C-mutators v14).** `project.setMembersMode {projectId, mode, members?: {id, userId, role}[]}` — to `custom`: `members` required and non-empty, every `userId` a space member, creates the rows; to `inherit`: deletes the rows; idempotent; admin of the project's space or instance admin, else `forbidden`. `projectMember.add {id, projectId, userId, role}`, `projectMember.setRole {id, role}`, `projectMember.remove {id}` — only when the project is `custom` (else `conflict`); admin of the space or instance admin, else `forbidden`. Every mutator and every `Tx` write to a row of a hidden project by a non-member → `not_found` (not `forbidden`: existence is not disclosed).

**Visibility rule (the one rule everything follows).** A row belongs to a project if it has `projectId`, or reaches a project through `taskId` (comments, attachments, links, time and so on), or through a module table's own project reference. For a project in `custom` mode such a row is visible only to the effective members of that project. The `projects` row and its `projectMembers` rows are visible only to them too (space admins excepted). Rows with no project (space-level, user-level, global) are unchanged. Adding/removing a project member or changing the mode → `_reset` for the affected users (as `spaceMembers`), so the replica drops the data at once.

**Where it applies (the executor lists each in the report).** Pull/bootstrap/WS fan-out (`apps/api/src/sync/viewers.ts`, `pull.service.ts`), `Tx` read/write checks (`server-tx.ts`), REST v1 and MCP (list, get, search: hidden entities absent / `404`), files (`apps/api/src/files/files.controller.ts`), full-text search, notifications and activity for hidden entities, module routes and jobs (a module row of a hidden project is not returned to non-members; webhooks and inbound endpoints are server-side and keep working). One shared helper `projectAccess(userId, projectId)` in the API; no per-site copies of the rule.

**Contract test.** A test enumerates all schema entities and fails if an entity with `projectId` or a task reference is not covered by the visibility rule (a new entity cannot be forgotten). Plus api tests: a removed member gets none of the project's rows from bootstrap and pull, `404` from REST by id, nothing from search and files; a member of another project is unaffected; with `inherit` the composition equals the space's.

**Stage 2 (web, separate task after stage 1 is merged).** Settings section «Участники»: switch «Как в пространстве» / «Свой состав», list with role change and removal, add from space members; inherited view read-only. Uses only the mutators above. i18n ru/en.

**Stage 1 as built.** The rule lives in the SQL function `project_role(user, project)` (migration 0034; null — no access; the instance admin is admin; a space guest is at most a guest) and is used through one API helper `projectAccess` (`apps/api/src/sync/project-access.ts`) and by module SQL. `changes.project_id` (set at write time, `PROJECT_REFS` says how an entity reaches its project) lets pull skip hidden rows; bootstrap, REST, MCP, files and `viewersOf` filter by the same expression. Server `Tx`: a row of a hidden project is absent for `get`/`scan` and `not_found` for writes; the rights follow the same `project_role` (in a custom project the role from `projectMembers`, so a project admin who is a space member may do admin-level project writes). A change of `spaceMembers.role` or `users.role` writes `_reset` for that user. Migration 0034 ends with a global `_reset` (the new entity and `membersMode` reach every client).

**Out of scope.** Per-entity (task-level) hiding, guests from outside the space, changing space roles from the project.
