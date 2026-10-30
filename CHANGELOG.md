# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.9.0] - public beta

### Added

- Local-first sync: IndexedDB replica, optimistic shared mutators, `changes` log, pull/push, WebSocket poke, offline queue.
- Authentication with login and password, sessions, roles (owner, admin, member, guest), first-run owner setup.
- Core task model: spaces, projects, statuses, tasks, subtasks, checklists, labels, assignees, comments, attachments, activity.
- Notifications and Web Push (VAPID).
- Personal API tokens, REST API `/api/v1` and an MCP server `/mcp`.
- Module system and the bundled modules in `modules/*`; sandboxed plugin pages.
- Self-hosting with `docker compose` (PostgreSQL 18, API, Caddy), backup, restore and upgrade scripts in `ops/`.

### Known limitations

- Issuing ACME certificates for a public domain has not been tested; see `docs/guides/deploy.md`.

[Unreleased]: https://gitlab.com/planarhq/planar/-/compare/v0.9.0...main
[0.9.0]: https://gitlab.com/planarhq/planar/-/tags/v0.9.0
