---
type: reference
status: closed
module: ops
updated: 2026-11-02
summary: ops contracts — prod stack env, volumes, Caddy headers and CSP, backup format v1, /api/health/ready and /api/metrics
related: ["docs/plan/ops.md", "docs/contracts/core.md", "docs/roadmap.md"]
---

# ops module contracts

Owner — the ops coordinator. Contract test — `apps/api/test/ops.contract.test.ts` (test names `ops-contract …`, edited only by the coordinator): checks the ` ```text ops-…` blocks below against `compose.yml`, `deploy/Caddyfile`, `apps/web/*.html`, `apps/api/src`, `ops/*.sh`. Checks of code that does not exist yet (metrics, `ops/` scripts) are skipped; `OPS_CONTRACT_STRICT=1` — an error.

No new dependencies are added (roadmap §8): Prometheus metrics — the text format by hand, without `prom-client`.

## C-ops-env v1

Variables of the prod stack. The source of values is `.env` next to `compose.yml` (docker compose reads it itself). Row: `| \`NAME\` | where | default | purpose |`; "where" — `api`, `postgres`, `caddy`, `compose` (ports), `ops` (scripts `ops/*.sh`). `required` — compose fails without a value (`${X:?…}`).

| name | where | default | purpose |
|---|---|---|---|
| `POSTGRES_PASSWORD` | postgres,api | required | password of the `postgres` user; api builds `DATABASE_URL` from it |
| `PLANAR_DOMAIN` | caddy,api | empty | domain: set — the Caddy site address, TLS from ACME, HTTP→HTTPS redirect. `localhost` or an IP — a self-signed certificate of Caddy's internal CA. Empty — site `:80`, HTTP only (local check, smoke) |
| `PUBLIC_URL` | api | `https://$PLANAR_DOMAIN` | origin for the Origin check and links (C-http); without a domain set explicitly, e.g. `http://localhost:8080` |
| `EXTRA_ORIGINS` | api | empty | extra allowed Origins, comma-separated (a second domain, an IP); links are built only from `PUBLIC_URL` |
| `COOKIE_SECURE` | api | `true` | `false` — only when running over HTTP |
| `PLANAR_SECRET_KEY` | api | empty | 32 bytes base64 (C-http v11); empty — features with secrets give `503 unavailable` |
| `VAPID_PUBLIC_KEY` | api | empty | Web Push (C-http) |
| `VAPID_PRIVATE_KEY` | api | empty | Web Push |
| `VAPID_SUBJECT` | api | empty | Web Push, `mailto:…` |
| `MAX_UPLOAD_MB` | api | `50` | file upload limit |
| `LOG_LEVEL` | api | `info` | pino level |
| `METRICS_TOKEN` | api | empty | token for `/api/metrics` (C-ops-health); empty — the endpoint answers `404 not_found` |
| `PLANAR_SUBNET` | compose,api | `172.30.0.0/24` | subnet of the `app` network (Caddy is in it); api gets it as `TRUST_PROXY`. Change it if it overlaps host networks |
| `HTTP_PORT` | compose | `80` | host port for Caddy's `:80` |
| `HTTPS_PORT` | compose | `443` | host port for Caddy's `:443` |
| `SETUP_TOKEN` | api | empty | C-launch-env: set — `POST /api/setup` requires the `X-Setup-Token` header |
| `DB_POOL_MAX` | api | `10` | C-launch-env: api connection pool size |
| `DEMO_MODE` | api | `false` | C-launch-env: demo mode (C-launch-demo) |
| `DEMO_RESET_HOURS` | api | `24` | C-launch-env: demo reset period for the banner |
| `PLANAR_REGISTRY` | compose | `registry.gitlab.com/planarhq/planar` | registry of the api and caddy images (C-launch-release); images `<registry>/api`, `<registry>/caddy` |
| `PLANAR_VERSION` | compose | `latest` | tag of the api and caddy images |
| `CLOUD_URL` | caddy | empty | cloud instances only (cloud-link): added to CSP `connect-src`; self-hosted `compose.yml` does not pass it |
| `BACKUP_DIR` | ops | `./backups` | directory of backup archives (C-ops-backup) |

Constant api values in `compose.yml` (not from `.env`): `DATABASE_URL=postgres://postgres:$POSTGRES_PASSWORD@postgres:5432/planar`, `PORT=3000`, `DATA_DIR=/data`, `TRUST_PROXY=$PLANAR_SUBNET`. The api and postgres ports are not published outside (the postgres port only in `deploy/compose.smoke.yml`).

Modules that need variables of their own (e.g. SMTP in p4) send the change as a `contract: …` line; the ops coordinator applies it in the next version.

## C-ops-volumes v2

v2: the web static files are built into the caddy image (`deploy/caddy.Dockerfile`, node stage → `/srv`), node and pnpm are not needed on the server; the host directory `./apps/web/dist` is not mounted.


Named compose volumes (the project name is the prefix). Block row: `<service> <volume> <path in container> <in backup: yes|no>`.

```text ops-volumes
postgres pgdata /var/lib/postgresql yes
api data /data yes
caddy caddy_data /data no
caddy caddy_config /config no
```

- `pgdata` — the Postgres 18 directory (image `pgvector/pgvector:pg18`, data in `/var/lib/postgresql/18/docker`); backed up through `pg_dump`, not by copying the directory.
- `data` — `DATA_DIR`: `files/<ab>/<cd>/<sha256>` (C-http) is in the backup; `tmp/` is not.
- `caddy_data` — ACME certificates and keys; not backed up, Caddy obtains them again.
- Web static files are in the caddy image (`/srv`), not a volume; `deploy/Caddyfile` is also inside the image.

## C-ops-headers v1

Caddy response headers on all site paths (both static files and the proxy to api). Block row: `Name: value`; in `deploy/Caddyfile` — `Name "value"` in the `header` block (the value exactly, on one line). The `Server` header is removed (`-Server`).

```text ops-headers
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
Content-Security-Policy: default-src 'self'; script-src 'self' {inline-hashes}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' {$CLOUD_URL}; worker-src 'self'; manifest-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'
```

- `{inline-hashes}` — `'sha256-<base64>'` of every inline `<script>` without `src` from `apps/web/index.html` and `apps/web/form.html`, space-separated, in order of appearance (currently — the theme script in `index.html`). The hash is of the text between `<script>` and `</script>` as is. The test checks it; if the script in web changes, the test breaks and ops updates the hash.
- HSTS is always sent: over HTTP the browser ignores it.
- `style-src 'unsafe-inline'` — Vue/TipTap/Reka style attributes. `img-src https:` — external images in descriptions. `connect-src 'self'` covers `ws:`/`wss:` of the same host; `{$CLOUD_URL}` — the browser uploads the import archive straight to the cloud (cloud-link), empty outside the cloud.
- External iframe plugins (p4) extend `frame-src` through a `contract: …` change, not directly.

## C-ops-backup v1

The archive is one file `$BACKUP_DIR/planar-<YYYYMMDDTHHMMSSZ>.tar` (UTC time). It is written as `….tar.partial` and renamed after the integrity check; on error `.partial` is deleted. Contents (tar without compression, flat):

```json ops-backup-manifest
{
  "format": "planar-backup",
  "version": 1,
  "created_at": "2026-10-25T03:00:00Z",
  "migrations": 19,
  "db": { "file": "db.dump", "sha256": "<hex>" },
  "files": { "file": "files.tar", "sha256": "<hex>", "count": 0 }
}
```

- `manifest.json` — as in the example; `migrations` — the number of rows in `drizzle.__drizzle_migrations` at backup time.
- `db.dump` — `pg_dump -Fc` of the `planar` database (from the postgres container).
- `files.tar` — `$DATA_DIR/files` with paths `files/<ab>/<cd>/<sha256>`; `count` — the number of files.
- Integrity (after writing and before restoring): sha256 of the parts = the manifest, `pg_restore -l db.dump` — exit code 0, `tar -t files.tar` — exit code 0, number of files = `count`. `--deep`: the name of every file = sha256 of its content.
- Rotation after a successful backup: the newest archive of each of the last 7 days (UTC) and the newest of each of the last 4 ISO weeks are kept; the one just created is never deleted; foreign files in `$BACKUP_DIR` are not touched.
- `ops/restore.sh <archive>`: checks integrity and `format`/`version` (unknown version — refusal), the archive's `migrations` ≤ the image's migration count (otherwise refusal: the archive is newer than the code). If the database has users — refusal without `--force`. It restores the database (`drop database … with (force)`, `create database`, `pg_restore`) and the files with api stopped; "has users" means `users` rows with `password_hash <> '!'` (the system automation user from the migration does not count); then starts api (api applies missing migrations at startup) and waits for `/api/health/ready`.
- Script exit code: 0 — success, otherwise an error with text in stderr.

## C-ops-health v1

Extends C-http (`docs/contracts/core.md` §Core endpoints; changed by a `contract: …` line from the main session). All three — without a session (`@Public`), outside `/api/v1`.

| method and path | output |
|---|---|
| `GET /api/health` | liveness, unchanged (C-http): `200 {ok: true, db: 'up'}` \| `503 {ok: false, db: 'down'}` |
| `GET /api/health/ready` | `200 {ok: true, db: 'up', migrations: 'ok', queue: 'up'}`; if anything is wrong — `503`, `ok: false` and `db: 'down'` \| `migrations: 'pending'` (fewer applied than in the image's journal) \| `queue: 'down'`. The queue is disabled by config (tests, `push.boss: false`) — `queue: 'off'`, does not affect `ok` |
| `GET /api/metrics` | `METRICS_TOKEN` empty — `404 not_found`. Otherwise `Authorization: Bearer <METRICS_TOKEN>` (constant-time comparison), missing/wrong — `401 unauthenticated`. Response — `200`, `text/plain; version=0.0.4`, Prometheus exposition format |

Approved by the main session as C-http v12. `/api/health/ready` returns only the component statuses from the table — no versions, connection strings or error texts. Token comparison — `crypto.timingSafeEqual` (different length — refusal without comparing). Required tests: without `METRICS_TOKEN` — 404, with a wrong token — 401, with the right one — 200 and all the names below.

Caddy proxies `/api/metrics` like any `/api/*`; the token is the only protection, hence it is required to enable the endpoint. Metrics (row: `name type labels`):

```text ops-metrics
planar_http_requests_total counter method,route,status
planar_http_request_duration_seconds histogram method,route
planar_ws_connections gauge path
planar_queue_jobs gauge queue,state
planar_db_size_bytes gauge -
```

- `route` — the Fastify route template (`/api/tasks/:id`), not the raw URL; without a route — `route="unmatched"`. Requests to `/api/metrics` and `/api/health*` are not counted.
- Histogram buckets (seconds): `0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10`.
- `planar_ws_connections{path}` — open `/ws` and `/collab` connections.
- `planar_queue_jobs{queue,state}` — `count(*)` from the pg-boss jobs table by queue name and pg-boss state as is; with `queue: 'off'` — no rows.
- `planar_db_size_bytes` — `pg_database_size(current_database())`.
- api logs — pino JSON to stdout; rotation — the docker `json-file` driver with `max-size: 10m`, `max-file: 5` for all `compose.yml` services.
