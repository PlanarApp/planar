# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://gitlab.com/planarhq/planar/-/compare/v0.10.0...main
[0.10.0]: https://gitlab.com/planarhq/planar/-/compare/v0.9.0...v0.10.0
[0.9.0]: https://gitlab.com/planarhq/planar/-/tags/v0.9.0
