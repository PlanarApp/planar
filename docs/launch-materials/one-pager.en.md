---
type: guide
status: active
module: launch
updated: 2026-10-30
summary: One-pager (EN): what Planar is, who it is for, what is in 0.9.0, how to start
related: ["docs/roadmap.md", "README.md", "docs/plan/launch.md"]
---

# Planar: one-pager

**A fast, simple task tracker for teams. Self-hosted, local-first, open source (Apache 2.0).** Version 0.9.0, public beta.

## What it is
A task tracker with a local replica of your data in the browser: the UI responds instantly and works offline. One instance is one workspace.

## What you get
- Tasks, subtasks, checklists, labels, assignees, comments, attachments, notifications, Web Push.
- Installable PWA with desktop and mobile layouts.
- REST API (`/api/v1`) and a built-in MCP server (`/mcp`) with personal tokens (`read` or `write`) for AI agents.
- Modules under `modules/*`: sprints, time, forms, automations, webhooks, dashboards, docs, gitlab and others; sandboxed plugin pages.
- Roles: owner, admin, member, guest.

## Self-hosting
`docker compose` with PostgreSQL 18, the API and Caddy (automatic TLS). Backup, restore and upgrade scripts in `ops/`. Guide: `docs/guides/deploy.md` (Russian).

## Services (planned)
The project plans a managed cloud, paid onboarding and custom module development. None of these is available yet; terms are not published.

## Limits of the beta
ACME certificates for a public domain are untested. Guides are in Russian.

## Links
Repo: https://gitlab.com/planarhq/planar (mirror https://github.com/PlanarApp/planar). Planned: planarhq.com (domain not registered). Contact: hello@planarhq.com (planned, not active).
