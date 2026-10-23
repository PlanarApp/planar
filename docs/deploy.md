---
type: "guide"
status: "active"
module: "work"
updated: "2026-10-23"
summary: "Prod-стек compose.yml (postgres, api, Caddy) и смоук ./dev.sh prod-smoke"
related: []
---

# Деплой

- Сборка web: `pnpm --filter @planar/web build` (статика `apps/web/dist` монтируется в Caddy).
- Запуск: `docker compose up -d --build`. Порты — `HTTP_PORT`, `HTTPS_PORT`; адрес — `SITE_ADDRESS` (по умолчанию `:80`), `PUBLIC_URL` должен совпадать с внешним адресом, за http — `COOKIE_SECURE=false`.
- Caddy (`deploy/Caddyfile`): `/api`, `/sync`, `/ws`, `/mcp`, `/files` → api:3000, остальное — статика с SPA-фолбэком.
- Смоук: `./dev.sh prod-smoke` — собирает web и api, поднимает стек в изолированном проекте (`COMPOSE_PROJECT_NAME`, `HTTP_PORT`), сидит БД с хоста через временно открытый порт postgres (`deploy/compose.smoke.yml`), прогоняет `e2e/prod` через Caddy и гасит стек с томами.
