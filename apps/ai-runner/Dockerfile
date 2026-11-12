# Build context — repository root.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @planar/ai-runner build \
 && pnpm --filter @planar/ai-runner deploy --prod /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
# docker.sock is mounted by compose (the container runs as root: the socket is root-owned)
EXPOSE 8080
CMD ["node", "dist/main.js"]
