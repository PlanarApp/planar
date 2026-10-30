---
title: Installation
description: Deploy Planar on a single VPS
---

# Installation (VPS)

The production stack is `compose.yml` in the repository root: `postgres`, `api`, `caddy`. The api and postgres ports are not published; only Caddy (80/443) is reachable from outside. Contracts (variables, volumes, headers, backup format, metrics) are in `docs/contracts/ops.md`. All commands below run from the repository root on the server (examples use `/opt/planar`).

What is verified and what is not: the stack, backup/restore and upgrade with rollback were exercised by tests (`ops/test-backup.sh`, `ops/test-upgrade.sh`, `./dev.sh prod-smoke`) over HTTP on `:80`. **Real ACME certificate issuance for a public domain was not tested**; only `caddy validate` of the Caddyfile with a domain and the self-signed path were.

## Server requirements

- One Linux VPS with Docker, the compose plugin (`docker compose`) and git.
- Node and pnpm are **not needed** on the server: web is built inside the caddy image (`deploy/caddy.Dockerfile`), api inside the api image (`apps/api/Dockerfile`).
- Image sizes per the OP-1/OP-1b reports: api ~713 MB, caddy ~95 MB (plus build layers and data). RAM and CPU requirements are not fixed in the repository.
- Ports 80 and 443 free and open (override with `HTTP_PORT`, `HTTPS_PORT`).
- The stack's `app` network is `172.30.0.0/24` (`PLANAR_SUBNET`). If it overlaps host networks, set another one in `.env` before the first start.

Get the code:

```bash
git clone https://gitlab.com/planarhq/planar.git /opt/planar && cd /opt/planar
```

## DNS and domain

1. Create an `A` record (and `AAAA` if you have IPv6) for the domain pointing at the server.
2. Make sure 80 and 443 are reachable from the internet: Caddy obtains the ACME certificate itself and redirects HTTP to HTTPS.
3. Set `PLANAR_DOMAIN=planar.example.com` in `.env`. `PUBLIC_URL` defaults to `https://$PLANAR_DOMAIN`.

`PLANAR_DOMAIN` values:

| value                | behavior                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| a domain             | ACME certificate, HTTP→HTTPS redirect                                                                               |
| `localhost` or an IP | self-signed certificate from Caddy's internal CA (the browser will warn)                                            |
| empty                | site on `:80`, HTTP only; then set `PUBLIC_URL` explicitly (e.g. `http://localhost:8080`) and `COOKIE_SECURE=false` |

Configure the variables as described in [Configuration](/configuration).

## First start and creating the owner

```bash
docker compose up -d
docker compose ps
```

`compose.yml` pulls prebuilt images `${PLANAR_REGISTRY:-registry.gitlab.com/planarhq/planar}/{api,caddy}:${PLANAR_VERSION:-latest}`. To build from source use `compose.build.yml` (`docker compose -f compose.yml -f compose.build.yml up -d --build`); the build takes several minutes.

Wait for readiness:

```bash
curl -fsS https://planar.example.com/api/health/ready
# {"ok":true,"db":"up","migrations":"ok","queue":"up"}
```

The api applies migrations on start. The owner is created by the setup wizard: while the system has no users, the first visit to the UI (`https://<domain>/`) shows an owner creation form. The same through the API: `GET /api/setup` → `{needed: true}`, then `POST /api/setup` with `{login, name, password}` → `201`; once users exist a repeat gives `409 conflict`. Open the address right after the start: until an owner exists anyone who can reach the site can fill in the form. To close that window set `SETUP_TOKEN` (see [Configuration](/configuration)).

Checking the default stack without a server: `./dev.sh prod-smoke` brings up the prod stack in an isolated project (`COMPOSE_PROJECT_NAME`, free ports), runs login, a task, WS, `/collab`, `/f/*`, a file upload, and tears the stack down with its volumes. It needs a checkout with node and pnpm and need not run on the prod server.
