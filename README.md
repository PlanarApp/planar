# Planar

Planar is a fast, simple task tracker for teams, with a local replica of your data in the browser, so the interface responds instantly and keeps working offline. One instance is one workspace. Self-hosted with Docker Compose.

<!-- screenshots -->

## Features

- Local-first sync: a replica in IndexedDB, optimistic mutations, a server change log (`changes`) and a WebSocket poke. Offline mode works because unconfirmed mutations are queued and re-applied after each pull.
- Installable PWA (Vue 3 + Vite), desktop and mobile layouts.
- Tasks, subtasks, checklists, labels, assignees, comments, attachments, notifications and Web Push.
- REST API (`/api/v1`) and a built-in MCP server (`/mcp`, Streamable HTTP) authenticated with personal API tokens (`plnr_...`, `read` or `write`).
- Modules: features are modules under `modules/*` (for example `sprints`, `time`, `forms`, `automations`, `webhooks`, `dashboards`, `docs`, `gitlab`). Modules are enabled per instance; plugins can also be embedded as sandboxed pages (see `examples/plugin-hello`).
- Self-hosting: `docker compose` with PostgreSQL 18 (pgvector), the API and Caddy (automatic TLS, static files).
- Backups and restore: scripts in `ops/` (`backup.sh`, `restore.sh`, `upgrade.sh`).

## Install

```bash
git clone https://gitlab.com/planarhq/planar.git
cd planar
echo "PLANAR_DOMAIN=planar.example.com" >> .env   # without it — localhost with a self-signed certificate
./start.sh
```

`start.sh` pulls ready images from the GitLab registry (`compose.yml` + `compose.prod.yml`), keeps data in `./data` (`postgres`, `api` — files, `caddy` — certificates) and generates missing `POSTGRES_PASSWORD`, `PLANAR_SECRET_KEY` and the VAPID keys (Web Push) into `.env`. Running it again updates the images to `PLANAR_VERSION` (default `latest`). Other variables (backups) are in [docs/guides/deploy.md](docs/guides/deploy.md). The first visit to the site shows a form that creates the owner, so open it right after the start. Building the images from source: `docker compose -f compose.yml -f compose.build.yml up -d --build`. The guides are currently written in Russian.

Connecting AI agents over MCP: [docs/guides/mcp.md](docs/guides/mcp.md).

## Links

- Repository: https://gitlab.com/planarhq/planar (mirror: https://github.com/PlanarApp/planar)
- Container images: `registry.gitlab.com/planarhq/planar/{api,caddy}`, `ghcr.io/planarapp/planar-{api,caddy}`
- Planned (domains are not registered yet): https://planarhq.com, https://docs.planarhq.com, https://demo.planarhq.com
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) | Security: [SECURITY.md](SECURITY.md) | Changelog: [CHANGELOG.md](CHANGELOG.md)
- Russian version: [README.ru.md](README.ru.md)

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). The Planar name and logo are not covered by the license, see [TRADEMARK.md](TRADEMARK.md).
