# Образ ИИ-агента planar-ai-agent. Контекст сборки — этот каталог.
FROM node:24-bookworm-slim

ARG GLAB_VERSION=1.130.0
ARG CLAUDE_CODE_VERSION=2.1.322
ARG OPENCODE_VERSION=1.19.5
ARG PLAYWRIGHT_VERSION=1.65.0
# dpcli отключён: источник не утверждён, внешний репозиторий в образ не клонируется (см. README.md).

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw \
    HOME=/tmp/home \
    XDG_CONFIG_HOME=/tmp/home/.config \
    XDG_CACHE_HOME=/tmp/home/.cache \
    npm_config_cache=/tmp/home/.npm \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    DISABLE_AUTOUPDATER=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl jq ripgrep ca-certificates \
 && corepack enable \
 && arch="$(dpkg --print-architecture)" \
 && curl -fsSL "https://gitlab.com/gitlab-org/cli/-/releases/v${GLAB_VERSION}/downloads/glab_${GLAB_VERSION}_linux_${arch}.deb" -o /tmp/glab.deb \
 && apt-get install -y /tmp/glab.deb \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "opencode-ai@${OPENCODE_VERSION}" "playwright@${PLAYWRIGHT_VERSION}" \
 && playwright install --with-deps chromium \
 && chmod -R a+rX /opt/pw \
 && rm -rf /var/lib/apt/lists/* /tmp/* /root/.npm

COPY entrypoint.sh /usr/local/bin/planar-agent-entrypoint
RUN chmod 755 /usr/local/bin/planar-agent-entrypoint

# Совместимо с read-only rootfs: /tmp и /work — tmpfs (создаёт runner).
RUN mkdir -p /work && chown 10001:10001 /work
USER 10001:10001
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/planar-agent-entrypoint"]
