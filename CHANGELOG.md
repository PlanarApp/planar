# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
