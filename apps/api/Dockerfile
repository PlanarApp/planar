# Контекст сборки — корень репозитория.
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @planar/api... build \
 && pnpm --filter @planar/api deploy --prod /out \
 && cp -r apps/api/drizzle /out/drizzle

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
