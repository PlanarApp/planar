#!/usr/bin/env bash
# Подготовка окружения ИИ-агента перед работой над задачей (действие «Разработка» harness-пакета dev):
# 1) зависимости — pnpm install --frozen-lockfile; 2) тестовая БД — TESTDB_URL / localhost:55432 или ./dev.sh testdb;
# 3) smoke-прогон тестов — проекты vitest без БД, при живой БД ещё apps/api/test/health.test.ts.
# Каждый шаг печатает строку «agent-setup: <шаг>: OK|FAIL|SKIP — <причина>»; в конце — сводка.
# Код выхода: 0 — все шаги OK или SKIP, 1 — какой-то шаг упал (агент сообщает об этом в comment результата).
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD

declare -a SUMMARY=()
FAILED=0
report() { # report <шаг> <OK|FAIL|SKIP> <причина>
  local line="agent-setup: $1: $2${3:+ — $3}"
  SUMMARY+=("$line")
  echo "$line"
  [ "$2" = FAIL ] && FAILED=1
  return 0
}

# --- 1. зависимости ---
# Прокси (HTTPS_PROXY, в образе агента ещё NODE_USE_ENV_PROXY=1) не должен перехватывать локальные адреса:
# иначе тесты, которые поднимают сервер на localhost (ai-runner), получают 503 от squid.
LOCAL_HOSTS=localhost,127.0.0.1,::1
export NO_PROXY="${NO_PROXY:+$NO_PROXY,}$LOCAL_HOSTS" no_proxy="${no_proxy:+$no_proxy,}$LOCAL_HOSTS"
HINT="NO_PROXY=$NO_PROXY no_proxy=$no_proxy"
# pnpm-шим corepack в старых образах агента не ходит через прокси (EAI_AGAIN) и кладёт бинарник в noexec /tmp:
# тогда pnpm скачивается с NODE_USE_ENV_PROXY=1 в COREPACK_HOME на диске (в node_modules, вне git).
if ! pnpm -v >/dev/null 2>&1; then
  export COREPACK_HOME="$ROOT/node_modules/.corepack"
  HINT="$HINT COREPACK_HOME=$COREPACK_HOME"
  NODE_USE_ENV_PROXY=1 pnpm -v >/dev/null 2>&1
fi
if ! v=$(pnpm -v 2>&1 | tail -1) || [ -z "$v" ]; then
  echo "$v" >&2
  report зависимости FAIL "pnpm не запускается (corepack не скачал pnpm: сеть/прокси)"
elif pnpm install --frozen-lockfile; then
  report зависимости OK "pnpm $v"
else
  report зависимости FAIL "pnpm install --frozen-lockfile (вывод выше)"
fi
DEPS_OK=$([ "$FAILED" = 0 ] && echo 1 || echo 0)

# --- 2. тестовая БД ---
DB_URL="${TESTDB_URL:-postgres://postgres:postgres@localhost:55432/postgres}"
db_alive() {
  node -e '
    const u = new URL(process.argv[1]);
    const s = require("net").connect(Number(u.port || 5432), u.hostname);
    s.setTimeout(3000);
    s.on("connect", () => process.exit(0));
    s.on("error", () => process.exit(1));
    s.on("timeout", () => process.exit(1));
  ' "$DB_URL"
}
DB_OK=0
if db_alive; then
  DB_OK=1
  report "тестовая БД" OK "$(node -e 'const u=new URL(process.argv[1]);console.log(u.host)' "$DB_URL") отвечает"
elif [ -n "${TESTDB_URL:-}" ]; then
  report "тестовая БД" FAIL "TESTDB_URL задан, но не отвечает"
elif ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  report "тестовая БД" SKIP "нет Docker и БД на localhost:55432 — тесты api с БД не запустить, их прогонит CI"
elif ./dev.sh testdb; then
  DB_OK=1
  report "тестовая БД" OK "контейнер planar-testdb (./dev.sh testdb)"
else
  report "тестовая БД" FAIL "./dev.sh testdb (вывод выше)"
fi

# --- 3. smoke-прогон тестов ---
if [ "$DEPS_OK" != 1 ]; then
  report "smoke-тесты" SKIP "зависимости не установлены"
else
  if pnpm exec vitest run --project shared --project ai-runner; then
    report "smoke-тесты" OK "проекты vitest shared, ai-runner"
  else
    report "smoke-тесты" FAIL "pnpm exec vitest run --project shared --project ai-runner (вывод выше)"
  fi
  if [ "$DB_OK" != 1 ]; then
    report "smoke-тесты api" SKIP "нет тестовой БД"
  elif pnpm exec vitest run --project api apps/api/test/health.test.ts; then
    report "smoke-тесты api" OK "apps/api/test/health.test.ts"
  else
    report "smoke-тесты api" FAIL "pnpm exec vitest run --project api apps/api/test/health.test.ts (вывод выше)"
  fi
fi

echo
echo "agent-setup: сводка"
printf '  %s\n' "${SUMMARY[@]}"
echo "agent-setup: тесты и pnpm дальше запускай с тем же env: export $HINT"
exit "$FAILED"
