# Контекст сборки — корень репозитория. Статика web собирается в образе, node на хосте не нужен.
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @planar/web build

FROM caddy:2
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
