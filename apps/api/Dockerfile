# Build context — repository root.
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @planar/api... build \
 && pnpm --filter @planar/api deploy --prod /out \
 && cp -r apps/api/drizzle /out/drizzle \
 && mkdir -p /out/docs-site \
 && cp -r docs-site/ru docs-site/en /out/docs-site/

FROM node:24-slim
ENV NODE_ENV=production
# build values for GET /api/version: CI passes them as build-args (.gitlab-ci.yml), locally — `dev`
ARG APP_COMMIT_SHA= APP_REF= APP_TAG= APP_BUILT_AT=
ENV APP_COMMIT_SHA=$APP_COMMIT_SHA APP_REF=$APP_REF APP_TAG=$APP_TAG APP_BUILT_AT=$APP_BUILT_AT
WORKDIR /app
COPY --from=build /out .
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
