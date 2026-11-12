# Образ ИИ-агента planar-ai-agent. Контекст сборки — этот каталог.
FROM node:24-bookworm-slim

ARG GLAB_VERSION=1.52.0
ARG CLAUDE_CODE_VERSION=2.0.0
ARG OPENCODE_VERSION=1.0.0
ARG PLAYWRIGHT_VERSION=1.49.0
# Источник dpcli уточнить: публичный репозиторий и ссылка (тег/коммит).
ARG DPCLI_REPO=https://example.invalid/dpcli.git
ARG DPCLI_REF=main

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw \
    HOME=/tmp/home \
    XDG_CONFIG_HOME=/tmp/home/.config \
    XDG_CACHE_HOME=/tmp/home/.cache \
    npm_config_cache=/tmp/home/.npm

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl jq ca-certificates \
 && corepack enable \
 && arch="$(dpkg --print-architecture)" \
 && curl -fsSL "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_${arch}.deb" -o /tmp/glab.deb \
 && apt-get install -y /tmp/glab.deb \
 && git clone --depth 1 --branch "${DPCLI_REF}" "${DPCLI_REPO}" /opt/dpcli \
 && ln -s /opt/dpcli/dpcli /usr/local/bin/dpcli \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "opencode-ai@${OPENCODE_VERSION}" "playwright@${PLAYWRIGHT_VERSION}" \
 && playwright install --with-deps chromium \
 && chmod -R a+rX /opt/pw /opt/dpcli \
 && rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm

COPY entrypoint.sh /usr/local/bin/planar-agent-entrypoint
RUN chmod 755 /usr/local/bin/planar-agent-entrypoint

# Совместимо с read-only rootfs: /tmp и /work — tmpfs (создаёт runner).
RUN mkdir -p /work && chown 10001:10001 /work
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/planar-agent-entrypoint"]
