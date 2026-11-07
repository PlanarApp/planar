# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://gitlab.com/planarhq/planar/-/compare/v0.11.0...main
[0.11.0]: https://gitlab.com/planarhq/planar/-/compare/v0.10.0...v0.11.0
[0.10.0]: https://gitlab.com/planarhq/planar/-/compare/v0.9.0...v0.10.0
[0.9.0]: https://gitlab.com/planarhq/planar/-/tags/v0.9.0
