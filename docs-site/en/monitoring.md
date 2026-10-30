---
title: Monitoring and troubleshooting
description: Health checks, metrics, logs and common problems
---

# Monitoring

Endpoints without a session:

| path                    | purpose                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`       | liveness: `200 {ok:true, db:'up'}` or `503 {ok:false, db:'down'}`                                                                                                                                           |
| `GET /api/health/ready` | readiness: `200 {ok:true, db:'up', migrations:'ok', queue:'up'}`; otherwise `503` with `db:'down'` / `migrations:'pending'` / `queue:'down'`. `queue:'off'` (queue disabled by config) does not affect `ok` |
| `GET /api/metrics`      | Prometheus; needs `Authorization: Bearer <METRICS_TOKEN>`; token not set: `404`, wrong: `401`                                                                                                               |

Caddy proxies `/api/metrics` like any `/api/*`, so the token is the only protection: set a long random `METRICS_TOKEN`.

Metrics:

| metric                                 | type      | labels                      |
| -------------------------------------- | --------- | --------------------------- |
| `planar_http_requests_total`           | counter   | `method`, `route`, `status` |
| `planar_http_request_duration_seconds` | histogram | `method`, `route`           |
| `planar_ws_connections`                | gauge     | `path` (`/ws`, `/collab`)   |
| `planar_queue_jobs`                    | gauge     | `queue`, `state`            |
| `planar_db_size_bytes`                 | gauge     | none                        |

`route` is the route template (`/api/tasks/:id`), not the raw URL. Requests to `/api/metrics` and `/api/health*` are not counted. Request and WS counters live in api memory and reset on restart.

Planar does not ship its own Grafana stack. An external Prometheus scrapes like this:

```yaml
scrape_configs:
  - job_name: planar
    scheme: https
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ['planar.example.com']
```

Grafana connects to that Prometheus as a data source (Prometheus or Grafana Cloud). There are no ready-made dashboards in the repository.

Logs: the api writes pino JSON to stdout; all services use the docker `json-file` driver with `max-size: 10m`, `max-file: 5`.

```bash
docker compose logs -f api
docker compose logs --tail 200 caddy postgres
```

For external liveness checks poll `/api/health/ready` (expect 200).

# Troubleshooting

| symptom                                                           | what to check                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compose up` fails asking to set POSTGRES_PASSWORD                | the variable is not set in `.env`                                                                                                                                                                                          |
| `/api/health/ready` → `503`, `db: 'down'`                         | `docker compose ps postgres`, `docker compose logs postgres`; on a heavily loaded host postgres can take long to become healthy (healthcheck up to 60 tries, 5 s apart)                                                    |
| `ready` → `migrations: 'pending'`                                 | fewer migrations applied than in the image: `docker compose logs api`; usually after a migration failure at start                                                                                                          |
| `ready` → `queue: 'down'`                                         | pg-boss is not responding: api logs, postgres state                                                                                                                                                                        |
| api does not start / restarts                                     | `docker compose logs api`; common causes: `POSTGRES_PASSWORD` differs from the already created volume, a configuration error                                                                                               |
| certificate not issued, browser complains                         | DNS `A`/`AAAA` points at the server; 80 and 443 are open (ACME validation uses them); `docker compose logs caddy`. Reminder: ACME issuance was not tested in the repository                                                |
| login does not stick, Origin errors                               | `PUBLIC_URL` must match the address in the browser; over HTTP set `COOKIE_SECURE=false`                                                                                                                                    |
| secret-dependent features return `503 unavailable`                | `PLANAR_SECRET_KEY` is not set                                                                                                                                                                                             |
| `/api/metrics` → `404` / `401`                                    | `METRICS_TOKEN` not set / wrong token                                                                                                                                                                                      |
| `restore.sh` refuses                                              | "archive unreadable" or integrity: the archive is damaged, use another; "archive newer than code": update the code to the archive's version; "database already has users": `--force`; "api did not become ready": api logs |
| `upgrade.sh` exited with code 1                                   | "new version not ready": images were restored, see `docker compose logs api` and fix the release; "migrations failed": the old api is still running; "backup failed": nothing changed                                      |
| `upgrade.sh` rolled the images back but the schema is already new | migrations are not rolled back; the old image is built for the expanding schema (migration rule). To bring data back use `ops/restore.sh --force` with the archive from step 1                                             |
| subnet `172.30.0.0/24` is taken                                   | set another `PLANAR_SUBNET` in `.env` and recreate the stack                                                                                                                                                               |
