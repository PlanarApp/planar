---
type: reference
status: closed
module: launch
updated: 2026-10-30
summary: launch contracts — SETUP_TOKEN, DB_POOL_MAX, DEMO_MODE, GET /api/setup, demo seed and reset, images, CI and release compose
related: ["docs/contracts/ops.md"]
---

# launch module contracts

Owner — the launch coordinator. Consumers: task 4 (flags), task 5 (demo seed, reset), task 3 (images, compose, export), task 6 (docs describes env). Any change — version +1 and a `task note` to the consumers. Contract test — `apps/api/test/launch.contract.test.ts` (names `launch-contract …`, edited only by the coordinator; written together with task 4).

## C-launch-env v1

New api variables. Parsers — in `apps/api/src/config.ts` next to `parseMaxUploadMb`, a configuration error is `throw new Error('<NAME>: ожидается …, получено "<raw>"')` at startup (the message text is Russian, as in the code). Each goes into `.env.example` and into the `C-ops-env` table (`docs/contracts/ops.md`, rows only; edited by the coordinator on a task's signal).

| name | default | meaning |
|---|---|---|
| `SETUP_TOKEN` | empty | empty — behavior as now. Set — `POST /api/setup` accepts the owner only with the `X-Setup-Token` header equal to the value (comparison `timingSafeEqual`); otherwise `403 forbidden`. The token is not logged |
| `DB_POOL_MAX` | `10` | integer ≥ 1 → `new pg.Pool({ connectionString, max })`; empty → 10; not an integer or < 1 → configuration error. Parser `parseDbPoolMax(raw)`, `createDb(url, max?)` |
| `DEMO_MODE` | `false` | `true`/`false` (case-insensitive), empty → `false`, anything else — an error. Parser `parseDemoMode(raw): boolean`. `true`: see C-launch-demo |
| `DEMO_RESET_HOURS` | `24` | integer ≥ 1, only the banner text in demo mode; the reset itself is done by cron (C-launch-demo) |

## C-launch-setup v1

Public `GET /api/setup` → `{ needed: boolean, tokenRequired: boolean, demo: boolean, demoResetHours: number }` (`demoResetHours` = `DEMO_RESET_HOURS` for the banner; `tokenRequired` = `SETUP_TOKEN` is set; `demo` = `DEMO_MODE`). The other fields and `POST` — as in `setup.controller.ts`; `POST` without/with a wrong token when `SETUP_TOKEN` is set → `403`, the token is checked before any DB queries. Web: the setup screen shows a "Setup token" field when `tokenRequired` and sends it in `X-Setup-Token`.

## C-launch-demo v1

`DEMO_MODE=true` enables in api:
- a banner in web (by `demo` from `GET /api/setup`): `Demo — data resets every {DEMO_RESET_HOURS} h`;
- `POST /api/auth/demo-login` (public; with the mode off — `404`): creates a session of the user with login `demo` (role `member`) the same way as a normal login; the login screen shows the "Try the demo" button when `demo`;
- sending email, web push and outgoing webhooks is disabled (no-op, no error); automations make no outgoing requests;
- `MAX_UPLOAD_MB` defaults to `2` if not set explicitly;
- changing the password and email of the `demo` user — `403`.

**Demo seed** — `apps/api/src/db/seed-demo.ts`, export `seedDemo(db: Db, now: Date = new Date()): Promise<void>`; CLI `pnpm --filter api seed:demo [--reset]`:
- `--reset` — clear the data (all application tables except the migration journal) and fill again; without the flag on a non-empty database (users exist, other than the system one) — the error `demo seed: database is not empty`;
- all texts are English; determinism: any randomness from a fixed seed (a PRNG with a constant), so that two runs with the same `now` give identical data;
- all dates are offsets from `now` (tasks with due dates in the next 1–6 weeks, some overdue by 1–5 days, sprints: a completed one `now-28d…now-14d` and an active one `now-14d…now+0d…+14d`, etc.);
- composition: 8–12 users (Latin logins, `demo` among them, all with `password_hash='!'` like the system one: login only through demo-login), avatars — SVG data URIs embedded in the seed or the project's existing avatar mechanism; 4–5 spaces (Product, Engineering, Marketing, Design, Support); projects with tasks of different statuses/priorities, labels, subtasks, checklists, comments with @mentions; an active and a completed sprint, milestones, goals, time tracking, a dashboard, documents, a chat with conversation, recurring tasks — every enabled module is populated so that the first screen is not empty;
- inserts through existing repositories/services or SQL within the schema; new schema migrations are forbidden.

**Reset** — `ops/demo-reset.sh`: calls `seed:demo --reset` in the stack's api container and exits with code 0/1; next to it `ops/systemd/planar-demo-reset.{service,timer}` modeled on those already in `ops/systemd`. A dump is not used: dates are computed from "today", a dump would go stale (a deviation from plan §2, rationale above).

## C-launch-release v2

Decision Q1: the main repository is GitLab (`gitlab.com/planarhq/planar`), CI — GitLab CI, registry — GitLab Container Registry; GitHub (`github.com/PlanarApp/planar`) is a mirror, images additionally in `ghcr.io/planarapp`. License Apache-2.0. v2 replaces v1 (where GitHub Actions/GHCR were the main path).

- CI: `.gitlab-ci.yml` in the root — stages lint, test (vitest), build (image build and push). Images are built on the tag `vX.Y.Z` (image tags `X.Y.Z`, `X.Y`, `latest`) and on main (`edge`) into `$CI_REGISTRY_IMAGE/api` and `$CI_REGISTRY_IMAGE/caddy`. Only `$CI_*` variables, no secrets in the file. `.github/workflows/ghcr.yml` is the only workflow: on a `v*` tag it publishes the same images to `ghcr.io/planarapp/planar-api` and `…/planar-caddy`; lint/test do not run on GitHub.
- `compose.yml` for users: `image: ${PLANAR_REGISTRY:-registry.gitlab.com/planarhq/planar}/api:${PLANAR_VERSION:-latest}` (and `/caddy`); `PLANAR_REGISTRY` and `PLANAR_VERSION` go into `.env.example` and into the C-ops-env table (edited by the coordinator on a task's signal); `build:` stays in `compose.build.yml` (an override for development/CI); the behavior of `.env` and C-ops-env does not change.
- Export to the public repo: `ops/export-public.sh <destination-dir>` — copies the indexed tree `git ls-files` without paths from `ops/export-exclude.txt` (the list from plan §1: `docs/plan/`, `docs/research/`, `docs/registry/`, `.dpcli/`, `.claude/`, `CLAUDE.md`, `dpcli.yml`, `e2e/_*.mjs`, `data/`, `build/`), makes one initial commit (or the next one — on a repeat over an existing repo), pushes nothing. Exit ≠ 0 if an excluded path remains in the target tree after the filter.
