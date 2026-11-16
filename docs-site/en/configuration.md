---
title: Configuration (.env)
description: Planar environment variables
---

# Configuration (.env)

The `.env` file sits next to `compose.yml`; compose reads it by itself. It holds secrets: do not commit it (`chmod 600 .env`).

| variable            | default                               | purpose                                                                                                                                                                                                                  |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD` | required                              | password of the `postgres` user; the api builds `DATABASE_URL` from it. Compose will not start without it                                                                                                                |
| `PLANAR_DOMAIN`     | empty                                 | site domain, see [Installation](/install)                                                                                                                                                                                |
| `PUBLIC_URL`        | `https://$PLANAR_DOMAIN`              | origin for the Origin check and links                                                                                                                                                                                    |
| `COOKIE_SECURE`     | `true`                                | `false` only when serving over HTTP                                                                                                                                                                                      |
| `PLANAR_SECRET_KEY` | empty                                 | 32 bytes base64; empty: features that need secrets answer `503 unavailable`                                                                                                                                              |
| `VAPID_PUBLIC_KEY`  | empty                                 | Web Push                                                                                                                                                                                                                 |
| `VAPID_PRIVATE_KEY` | empty                                 | Web Push                                                                                                                                                                                                                 |
| `VAPID_SUBJECT`     | empty                                 | Web Push, `mailto:…`                                                                                                                                                                                                     |
| `MAX_UPLOAD_MB`     | `50`                                  | file upload limit                                                                                                                                                                                                        |
| `LOG_LEVEL`         | `info`                                | pino level                                                                                                                                                                                                               |
| `METRICS_TOKEN`     | empty                                 | token for `/api/metrics`; empty: the endpoint answers `404`                                                                                                                                                              |
| `PLANAR_SUBNET`     | `172.30.0.0/24`                       | subnet of the `app` network; the api receives it as `TRUST_PROXY` (`X-Forwarded-For` is trusted only from there)                                                                                                         |
| `HTTP_PORT`         | `80`                                  | host port for Caddy's `:80`                                                                                                                                                                                              |
| `HTTPS_PORT`        | `443`                                 | host port for Caddy's `:443`                                                                                                                                                                                             |
| `SETUP_TOKEN`       | empty                                 | when set, `POST /api/setup` (owner creation) is accepted only with an `X-Setup-Token` header equal to this value, otherwise `403`; the setup screen shows a "Setup token" field. Empty: open until the first user exists |
| `DB_POOL_MAX`       | `10`                                  | maximum Postgres pool connections, integer ≥ 1; anything else is a configuration error at start                                                                                                                          |
| `DEMO_MODE`         | `false`                               | `true`: public demo (banner, "Try the demo" login, no outgoing email/push/webhooks, `MAX_UPLOAD_MB` defaults to 2). Do not enable on a regular install                                                                   |
| `DEMO_RESET_HOURS`  | `24`                                  | banner text only; the reset itself is a cron job                                                                                                                                                                         |
| `PLANAR_REGISTRY`   | `registry.gitlab.com/planarhq/planar` | registry of the api and caddy images                                                                                                                                                                                     |
| `PLANAR_VERSION`    | `latest`                              | image tag                                                                                                                                                                                                                |
| `BACKUP_DIR`        | `./backups`                           | backup archive directory (read by the `ops/` scripts)                                                                                                                                                                    |

## Generating secrets

On a server with openssl:

```bash
touch .env && chmod 600 .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "PLANAR_SECRET_KEY=$(openssl rand -base64 32)" >> .env
echo "METRICS_TOKEN=$(openssl rand -hex 32)" >> .env
echo "SETUP_TOKEN=$(openssl rand -hex 16)" >> .env
echo "PLANAR_DOMAIN=planar.example.com" >> .env
```

The VAPID pair (a P-256 key) is generated by the same script as `vapid()` in `dev.sh`. The server has no Node, so run it in a throwaway container:

```bash
docker run --rm node:24-slim node -e "
  const {privateKey}=require('crypto').generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const j=privateKey.export({format:'jwk'});
  const b=(s)=>Buffer.from(s,'base64url');
  const pub=Buffer.concat([Buffer.from([4]),b(j.x),b(j.y)]).toString('base64url');
  console.log('VAPID_PUBLIC_KEY='+pub+'\nVAPID_PRIVATE_KEY='+j.d+'\nVAPID_SUBJECT=mailto:admin@example.com');
" >> .env
```

Replace `VAPID_SUBJECT` with your own address. **Do not change `PLANAR_SECRET_KEY` and `POSTGRES_PASSWORD` after the first start**: the key encrypts stored tokens (for example GitLab), and the password is already written into the database in `PLANAR_DATA_DIR/postgres`. Keep `.env` separately from data backups; backup archives do not contain it.
