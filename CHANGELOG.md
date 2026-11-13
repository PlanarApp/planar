# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Forms: a personal one-time or expiring link bound to an existing task; the answer is added to the task as a comment. Created in the form settings.
- New module `ai` (turns on together with `automations`): the bot «ИИ» — an active member of the space without sign-in, visible in assignee and mention pickers, skipped by due reminders, notifications and «only people» automation triggers.
- Settings → AI: a connection to an AI provider (OpenAI, Anthropic, OpenAI-compatible) per level — instance, space, project; the nearest level applies. The key is stored encrypted and never shown, a test call checks the connection on save.
- AI actions of a project and the automation action "Run AI" (admins only): when a task with the AI among its assignees fits the rule, the AI reads the instruction from a project document and the task, then comments, writes a plan into the description, sets status, labels and fields, creates subtasks, postpones, escalates to the project lead or writes documents. If it needs an answer, it asks in comments assigned to a person and moves the task to «Clarify»; answering in those threads returns the task and the work goes on.
- Assignments to the AI without rules: a comment assigned to the AI, `@ai` in a comment, a checklist item on the AI (done in order). The AI answers in the thread. A number field «Budget» on a task caps what the AI may spend on it; when it is used up, the AI asks to extend it.
- Documents: version history — the page menu "Version history" lists versions (when, who, editor / API / restore), shows a version read-only and restores it. Edits of one author from one source within 10 minutes form one version; the last 100 versions of a page are kept.
- REST `PATCH /api/v1/docs/:id` and MCP `update_doc`: `replace: {find, replace}` changes one fragment of the markdown without sending the whole document (an error if the fragment is missing or not unique).
- REST `GET /api/v1/docs/:id?section=` and MCP `get_doc` `section`: only the section under the given heading.
- Comments through REST and MCP: a reply and an assignee on creation; REST `PATCH /api/v1/comments/:id` and MCP `update_comment` assign or unassign, complete or reopen a comment and edit its text.
- MCP tools for every REST function: `unlink_tasks`, `list_time_entries`, `get_timer`, `list_sprints`, `list_automations`; `get_task` also returns the task links.
- AI agent runs: a live log in the task's «AI» tab and in «AI tasks» — the agent's thinking, tool calls, commands and their shortened output, as in the Claude Code chat. Secrets and tokens are masked by the server; only the last 500 events of a run are kept.
- Settings → AI and the setup wizard: pick a ready provider (OpenAI, Anthropic, Google Gemini, OpenRouter, DeepSeek, Mistral, Groq) — the API URL is filled in; «Custom API URL» keeps the manual fields. After the key is entered, the model is picked from the provider's list; typing a name still works.
- Task merge: «Merge into task…» in the task menu and «Merge…» in the bulk action bar of the list, board and table (2+ selected tasks of one space — mark the target, the others merge into it). Comments, attachments, time, links, subtasks, assignees and watchers move to the target; merged tasks get the «Cancelled» status and the link «duplicates». Mutator `task.merge` takes `ids` and `linkIds` lists.
- AI harness-retro: the task «harness-retro» (created when the AI is set up in a project, again after a deletion) collects subtasks — what got in the way of a run (the new result field `friction`), results of assignments and chat, admins' answers to the bot («не так», a status rolled back by hand after a run). Every N frictions or every N days the AI groups them and proposes an edit of an instruction of the active pack (or a new action with a rule): a subtask in «Clarify» on an admin with the diff in a comment; the answer in its thread — «применить», «закрыть» or what to redo. Settings → AI → harness-retro: the switch and the frequency.

### Changed

- The key encryption of GitLab, email and AI connections lives in one place (`packages/server-kit`).
- Settings → AI tasks: when the runner is not set up, a notice says that agent actions will not start and how to turn the runner on.

### Fixed

- Documents: a page changed through REST/MCP while closed no longer gets its text doubled when opened in a browser that had it open before.
- AI setup wizard: a project with its own AI connection is shown as connected.
- Documents: a page opened from a task has a "Back" button, and the browser's back returns to the task again (the first jump into a module used to replace the task in history).

## [0.13.0] - 2026-11-10

### Added

- Time tracking: duration and estimate as `30m`, `2h`, `1d`, `1w` (1d = 8h, 1w = 5d); a "Billable" flag on entries; the task's time entries of every user, own ones are edited in the same form and deleted.
- Time export to CSV for a period: admins pick the people, everyone else exports own entries (date, project, task, user, minutes, comment, billable).
- Checklist: an assignee on an item (a task with my open item is mine, a notification on assignment); an item turns into a task or a subtask; nested items with Tab / Shift+Tab, the menu and drag and drop.
- Selected text in a description or a comment turns into a task or a subtask.
- Completing a task shows its unfinished subtasks and open assigned comments.
- "My day": "Add to my day", "Tomorrow" and "Remove from day" in the "Due" menu; a regular task view under the planner.
- List: a "…" button at the right of a row opens the task actions menu.
- Counters on the "My work" tabs: open comments, unread mentions, activity, "My day", "Assigned", "Created", "Watching".
- "Sign in as" any member of a node and from the "Users" list.
- Favorites are stored on the server and follow you across devices.

### Changed

- Task time control: start/stop and "+" are small and frameless like the other properties; the top bar timer stops on the time and opens the task on the title.
- Assigned comments: "Complete" on the left, the assignee on the right opens the assign menu with avatars; replies of any depth can be assigned and completed; a collapsed assigned comment shows only the assignee's name.
- "Assignee = me" and the MCP `my_tasks` tool include assigned comments and checklist items.
- `@@` / `@@@` inserts look like links and open in the app.
- "My day" cards: key and status, the date with a reschedule menu on the right, the title in up to two lines; the task list uses the same cards.
- Mobile task header: narrower "back" and "favorite" buttons, smaller indents.
- Demo: shared modules (chat, import, email, webhooks, plugins) are on, every feature has demo data.

### Fixed

- Mobile chat: the app shrinks above the keyboard, the page no longer jumps up.
- Arrow navigation in the list works right after opening "Tasks" and after picking a status.
- "Reports › Time" on narrow screens: the header wraps, the table scrolls inside its block.

## [0.12.0] - 2026-11-07

### Added

- Task window tabs: subtasks, checklist, attachments and links are tabs with done/total counters; GitLab tab with icons.
- Task history shows what changed from what to what.
- Custom fields in the task window are property rows, no setup needed.
- Assigned comments: a card in the task and a mobile view in "My work".
- Comments: input above the feed, newest first, sorting and a filter by type; long comments and descriptions collapse under "Expand", consecutive photos show as thumbnails.
- Formatting in task descriptions and comments as in Docs; `@@` and `@@@` work in descriptions as in comments.
- "My day": tasks marked with a sun in the list, the D key adds/removes; overdue and today's tasks first, undated below; cards in two lines.
- Views: "Hide empty groups" in the "View" menu; saved views are reordered by drag and drop; the "Tasks" tab opens the last selected view.
- Favorites in the sidebar are reordered by drag and drop, also in the collapsed sidebar.
- Hotkeys: j/k switch tasks in the side panel, f — quick view filter by title/description, s/a/m/d act on the selected task; hotkeys work on non-English keyboard layouts.
- Side panel: a pin button, copy task key and link.
- "Import/Export" settings section: module import, cloud data export/import, backup and restore for self-hosted.
- "About" shows the release version and the version history.
- Install the app: a bottom sheet on every visit until the app is installed.
- A node color can be cleared ("No color").

### Changed

- "My work": sections are tabs with icons, "My day" first; view switching moved to the "View" menu, view tabs removed from "Tasks" too.
- Table: column selection moved to the "View" menu.
- Changed view: "Save for me" for everyone, "Save for everyone" for admins only.
- A saved view opens a task in a window; switching layout stays in the view.
- Chat input looks like a messenger composer.
- List: smaller left indent, drag handle inside the row; inline title editing is multiline; assignee column shows avatars only.
- Comment actions in one row of icons; "Done · Assigned: avatar" on the comment header line.
- Collapsed sidebar: favorites above projects, a project without an icon shows the first two letters of its key.
- Trial badge shows only the number of days, the full text in a tooltip.
- "Cloud" and "About" at the bottom of settings; a login hint after the first sign-in.
- Favorite star on the left of the task header; empty "Docs" and "Chat" are centered with a create button.
- Update toast shows an animated progress bar.

### Fixed

- Esc closes an open picker instead of the task window.
- List focus is kept when a task drops out of the view; the side panel switches to the next task.
- List navigation no longer outlines the whole list.
- Cloud archive upload: CSP allows `CLOUD_URL`.
- The "Upload" button is enabled when the instance name is correct.

## [0.11.0] - 2026-11-05

### Added

- Cloud link (Planar Cloud instances): one-time sign-in from the cloud dashboard (`GET /api/auth/handoff`), trial state, the "Cloud" settings section with own-domain binding (paid subscription only), data export and import from an export archive.
- "About" section in settings.
- "My day": a plan of tasks for today, ordered by drag and drop, "Move to tomorrow"; a section on top of "My work" and a tab in every node.
- Space and project lead, project default assignee.
- Time tracking as a task property: start/stop, tracked time, a menu with a form and entries; time on cards and rows of views.
- Dashboard templates on creation (overview, my work, current sprint).
- Comments: replies of any depth (deleting removes the subtree); collapsed comments show assignee, status and reply count.
- Notifications: a "Read" mark on each item; status changes shown as "before → after" in the bell and push.
- Views: "Show task key" for list and board; "Wrap titles" on list, board and table.
- Project settings: show and change the project key.
- MCP: project vocabulary, status names, filter by status category.
- Goals: explanation and an example in the empty state, hints for key result types.

### Changed

- "My work": a new task is assigned to yourself; project views show only that project's statuses and labels.
- The task side panel pushes the screen aside instead of covering it; a closed panel leaves no empty space.
- Task card: description right under the title; record counts on module tabs.
- "Instance modules" is a section of settings instead of a profile menu item.
- View "Save for everyone" / "Reset" is a badge in the bottom right corner.
- Settings fit on a 390 px mobile screen.
- Static files are served with Cache-Control so the PWA picks up new releases.
- `.env.example` lists every variable with its possible values.

### Fixed

- Dashboard, automation and goal filters by status or label match same-named statuses of all projects.
- Hotkeys no longer fire while typing in a field inside shadow DOM (emoji search).
- The last word is kept when Enter is pressed on a mobile keyboard.
- The demo banner takes the reset interval from `/api/setup`.

## [0.10.0] - 2026-11-02

### Added

- `start.sh` and `compose.prod.yml`: run from ready images in the registry, data in `./data`, missing secrets generated into `.env`.
- GitLab: connections are set in a project's settings, and a project can have several (GitLab URL, token, repository each). Merge requests link only to tasks of the connection's project.

### Changed

- Navigation: no breadcrumbs and task keys in the header; the favourites star is in the header and in chat; "Mine" replaces Me Mode.
- A node remembers its last tab, "My work" is the default; the sections of "My work" are a menu on its tab.
- The view of a node's tab is saved on the server with a button.

### Removed

- The workspace-wide GitLab settings. The migration moves the existing connection to every project that already has linked merge requests from its repository; repositories without linked merge requests have to be connected again. The poll interval is fixed at 120 s.

## [0.9.0] - 2026-10-30 (public beta)

### Added

- Local-first sync: IndexedDB replica, optimistic shared mutators, `changes` log, pull/push, WebSocket poke, offline queue.
- Authentication with login and password, sessions, roles (owner, admin, member, guest), first-run owner setup.
- Core task model: spaces, projects, statuses, tasks, subtasks, checklists, labels, assignees, comments, attachments, activity.
- Notifications and Web Push (VAPID).
- Personal API tokens, REST API `/api/v1` and an MCP server `/mcp`.
- Module system and the bundled modules in `modules/*`; sandboxed plugin pages.
- Self-hosting with `docker compose` (PostgreSQL 18, API, Caddy), backup, restore and upgrade scripts in `ops/`.
- `SETUP_TOKEN` protects first-run owner setup, `DB_POOL_MAX` limits database connections, `DEMO_MODE` runs a resettable demo instance with an English demo seed.
- Documentation site (`docs-site/`, VitePress, English and Russian) and English contract documents.

### Known limitations

- Issuing ACME certificates for a public domain has not been tested; see `docs/guides/deploy.md`.

[Unreleased]: https://gitlab.com/planarhq/planar/-/compare/v0.13.0...main
[0.13.0]: https://gitlab.com/planarhq/planar/-/compare/v0.12.0...v0.13.0
[0.12.0]: https://gitlab.com/planarhq/planar/-/compare/v0.11.0...v0.12.0
[0.11.0]: https://gitlab.com/planarhq/planar/-/compare/v0.10.0...v0.11.0
[0.10.0]: https://gitlab.com/planarhq/planar/-/compare/v0.9.0...v0.10.0
[0.9.0]: https://gitlab.com/planarhq/planar/-/tags/v0.9.0
