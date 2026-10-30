---
type: guide
status: active
module: launch
updated: 2026-10-30
summary: English version of the Habr article: how local-first sync works in the Planar task tracker
related: ["docs/roadmap.md", "README.md", "docs/plan/launch.md"]
---

# A task tracker with local-first sync: how it works

Planar is a task tracker for teams with a local replica of your data in the browser, so the UI responds without waiting for the network and keeps working offline. One instance is one workspace, self-hosted with Docker Compose. Open source (Apache 2.0): https://gitlab.com/planarhq/planar (mirror: https://github.com/PlanarApp/planar). Version 0.9.0, public beta.

This post describes the sync design. Source: `docs/roadmap.md`, sections 3 and 7.

## The idea

The client reads and writes a local database (IndexedDB via Dexie) instead of fetching every screen from the server. The network is only used for background sync. That gives instant responses, and offline mode almost for free.

## Mutations: one function, two places

Every change is a named function from `packages/shared/mutators`. The same function runs twice:

1. on the client, optimistically, over Dexie;
2. on the server, inside a Drizzle transaction.

Both go through a shared `Tx {get, put, del, scan}` interface. The server also checks permissions.

## Change log and poke

Each server write appends a row to `changes(seq bigserial, space_id, entity, id, op, data)` and issues `NOTIFY` (PostgreSQL LISTEN/NOTIFY). A WebSocket gateway sends `poke{seq}` to connected clients. The client then calls `pull?cursor=` and receives only changes from its own spaces. Queues, pub/sub and cache all live in PostgreSQL 18; there is no Redis.

## Offline and rebase

Unconfirmed mutations are queued in IndexedDB. After each pull the client takes the server state and re-applies the unconfirmed mutations on top of it: a rebase, as in Replicache. Edits made offline are not lost and reach the server after reconnecting.

## Conflicts

The rule is last-write-wins per field, with the server as the source of truth. This is a simple rule, not a CRDT: if two people edit the same field at the same time, the one the server accepted last wins.

## Speed budgets

The roadmap sets target budgets checked at acceptance. These are project targets, not benchmark results we are publishing:

- initial JS <= 200 KB gzipped;
- cold start with 10,000 tasks to interactive <= 2 s, warm start from IndexedDB <= 450 ms;
- local mutation to repaint <= 50 ms;
- an edit in one client appears in another <= 500 ms (local stack).

## Stack

Node 24, NestJS 11 + Fastify, Drizzle, pg-boss, Vue 3.5 + Vite, Dexie, Tailwind 4, TipTap, Vitest and Playwright (`docs/roadmap.md`, section 2).

## Around the sync

- REST API `/api/v1` and a built-in MCP server `/mcp` (Streamable HTTP) with personal `plnr_...` tokens (`read` or `write`): `docs/guides/mcp.md`.
- Modules under `modules/*` (18 directories in the repo, e.g. `sprints`, `time`, `forms`, `automations`, `webhooks`, `dashboards`, `docs`, `gitlab`), plus sandboxed plugin pages.
- Backup and restore: `ops/backup.sh`, `ops/restore.sh`, `ops/upgrade.sh`.

## Try it

```bash
git clone https://gitlab.com/planarhq/planar.git
cd planar
cp .env.example .env   # set POSTGRES_PASSWORD, PLANAR_DOMAIN and the rest
docker compose up -d
```

For a real server see `docs/guides/deploy.md`. The first visit shows a form that creates the owner, so open the site right after start.

## Limitations

- Issuing ACME certificates for a public domain has not been tested (CHANGELOG, 0.9.0).
- The guides are currently in Russian.
- The site and demo (planarhq.com, docs.planarhq.com, demo.planarhq.com) are planned; the domains are not registered yet.
