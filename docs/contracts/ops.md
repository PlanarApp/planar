---
type: reference
status: active
module: ops
updated: 2026-10-25
summary: Контракты ops — env prod-стека, тома, заголовки Caddy и CSP, формат бэкапа v1, /api/health/ready и /api/metrics
related: ["docs/plan/ops.md", "docs/contracts/core.md", "docs/roadmap.md"]
---

# Контракты модуля ops

Владелец — координатор ops. Контрактный тест — `apps/api/test/ops.contract.test.ts` (имена тестов `ops-contract …`, правит только координатор): сверяет блоки ` ```text ops-…` ниже с `compose.yml`, `deploy/Caddyfile`, `apps/web/*.html`, `apps/api/src`, `ops/*.sh`. Проверки кода, которого ещё нет (метрики, скрипты `ops/`), пропускаются; `OPS_CONTRACT_STRICT=1` — ошибка.

Новые зависимости не добавляются (roadmap §8): метрики Prometheus — текстовый формат вручную, без `prom-client`.

## C-ops-env v1

Переменные prod-стека. Источник значений — `.env` рядом с `compose.yml` (docker compose читает его сам). Строка: `| \`ИМЯ\` | где | по умолчанию | назначение |`; «где» — `api`, `postgres`, `caddy`, `compose` (порты), `ops` (скрипты `ops/*.sh`). `обязательна` — compose падает без значения (`${X:?…}`).

| имя | где | по умолчанию | назначение |
|---|---|---|---|
| `POSTGRES_PASSWORD` | postgres,api | обязательна | пароль пользователя `postgres`; api собирает из неё `DATABASE_URL` |
| `PLANAR_DOMAIN` | caddy,api | пусто | домен: задан — адрес сайта Caddy, TLS от ACME, редирект HTTP→HTTPS. `localhost` или IP — самоподписанный сертификат внутреннего CA Caddy. Пусто — сайт `:80`, только HTTP (локальная проверка, smoke) |
| `PUBLIC_URL` | api | `https://$PLANAR_DOMAIN` | origin для проверки Origin и ссылок (C-http); без домена задаётся явно, напр. `http://localhost:8080` |
| `COOKIE_SECURE` | api | `true` | `false` — только при работе по HTTP |
| `PLANAR_SECRET_KEY` | api | пусто | 32 байта base64 (C-http v11); пусто — функции с секретами `503 unavailable` |
| `VAPID_PUBLIC_KEY` | api | пусто | Web Push (C-http) |
| `VAPID_PRIVATE_KEY` | api | пусто | Web Push |
| `VAPID_SUBJECT` | api | пусто | Web Push, `mailto:…` |
| `MAX_UPLOAD_MB` | api | `50` | лимит загрузки файла |
| `LOG_LEVEL` | api | `info` | уровень pino |
| `METRICS_TOKEN` | api | пусто | токен `/api/metrics` (C-ops-health); пусто — эндпоинт отвечает `404 not_found` |
| `PLANAR_SUBNET` | compose,api | `172.30.0.0/24` | подсеть сети `app` (в ней Caddy); api получает её как `TRUST_PROXY`. Меняется, если пересекается с сетями хоста |
| `HTTP_PORT` | compose | `80` | порт хоста для `:80` Caddy |
| `HTTPS_PORT` | compose | `443` | порт хоста для `:443` Caddy |
| `BACKUP_DIR` | ops | `./backups` | каталог архивов бэкапа (C-ops-backup) |

Постоянные значения api в `compose.yml` (не из `.env`): `DATABASE_URL=postgres://postgres:$POSTGRES_PASSWORD@postgres:5432/planar`, `PORT=3000`, `DATA_DIR=/data`, `TRUST_PROXY=$PLANAR_SUBNET`. Порт api и postgres наружу не публикуется (порт postgres — только в `deploy/compose.smoke.yml`).

Модули, которым нужны свои переменные (напр. SMTP у p4), присылают правку строкой `contract: …`; координатор ops вносит её следующей версией.

## C-ops-volumes v1

Именованные тома compose (имя проекта — префикс). Строка блока: `<сервис> <том> <путь в контейнере> <в бэкапе: yes|no>`.

```text ops-volumes
postgres pgdata /var/lib/postgresql yes
api data /data yes
caddy caddy_data /data no
caddy caddy_config /config no
```

- `pgdata` — каталог Postgres 18 (образ `pgvector/pgvector:pg18`, данные в `/var/lib/postgresql/18/docker`); в бэкап — через `pg_dump`, не копией каталога.
- `data` — `DATA_DIR`: `files/<ab>/<cd>/<sha256>` (C-http) в бэкапе; `tmp/` — нет.
- `caddy_data` — сертификаты и ключи ACME; не бэкапится, Caddy получит заново.
- Статика web — `./apps/web/dist` только для чтения (собирается до `up`), не том.

## C-ops-headers v1

Заголовки ответов Caddy на всех путях сайта (и статика, и прокси к api). Строка блока: `Имя: значение`; в `deploy/Caddyfile` — `Имя "значение"` в блоке `header` (значение — точно, одной строкой). Заголовок `Server` удаляется (`-Server`).

```text ops-headers
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
Content-Security-Policy: default-src 'self'; script-src 'self' {inline-hashes}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'
```

- `{inline-hashes}` — `'sha256-<base64>'` каждого встроенного `<script>` без `src` из `apps/web/index.html` и `apps/web/form.html`, через пробел, в порядке появления (сейчас — скрипт темы в `index.html`). Хэш — от текста между `<script>` и `</script>` как есть. Тест сверяет; поменяли скрипт в web — тест ломается, хэш обновляет ops.
- HSTS отправляется всегда: по HTTP браузер его игнорирует.
- `style-src 'unsafe-inline'` — стили-атрибуты Vue/TipTap/Reka. `img-src https:` — внешние картинки в описаниях. `connect-src 'self'` покрывает `ws:`/`wss:` того же хоста.
- Внешние iframe-плагины (p4) расширяют `frame-src` правкой `contract: …`, не напрямую.

## C-ops-backup v1

Архив — один файл `$BACKUP_DIR/planar-<YYYYMMDDTHHMMSSZ>.tar` (время UTC). Пишется как `….tar.partial` и переименовывается после проверки целостности; при ошибке `.partial` удаляется. Содержимое (tar без сжатия, плоско):

```json ops-backup-manifest
{
  "format": "planar-backup",
  "version": 1,
  "created_at": "2026-10-25T03:00:00Z",
  "migrations": 19,
  "db": { "file": "db.dump", "sha256": "<hex>" },
  "files": { "file": "files.tar", "sha256": "<hex>", "count": 0 }
}
```

- `manifest.json` — как пример; `migrations` — число строк `drizzle.__drizzle_migrations` на момент бэкапа.
- `db.dump` — `pg_dump -Fc` базы `planar` (из контейнера postgres).
- `files.tar` — `$DATA_DIR/files` с путями `files/<ab>/<cd>/<sha256>`; `count` — число файлов.
- Целостность (после записи и перед восстановлением): sha256 частей = манифест, `pg_restore -l db.dump` — код 0, `tar -t files.tar` — код 0, число файлов = `count`. `--deep`: имя каждого файла = sha256 его содержимого.
- Ротация после успешного бэкапа: остаются самый новый архив каждого из 7 последних дней (UTC) и самый новый каждой из 4 последних ISO-недель; только что созданный не удаляется никогда; чужие файлы в `$BACKUP_DIR` не трогаются.
- `ops/restore.sh <архив>`: проверяет целостность и `format`/`version` (неизвестная версия — отказ), `migrations` архива ≤ числа миграций образа (иначе отказ: архив новее кода). В базе есть пользователи — отказ без `--force`. Восстанавливает базу (`pg_restore --clean --if-exists`) и файлы при остановленном api, запускает api (недостающие миграции применит api при старте), ждёт `/api/health/ready`.
- Код выхода скриптов: 0 — успех, иначе ошибка с текстом в stderr.

## C-ops-health v1

Дополняет C-http (`docs/contracts/core.md` §Эндпоинты core; правка — строкой `contract: …` главной). Все три — без сессии (`@Public`), вне `/api/v1`.

| метод и путь | выход |
|---|---|
| `GET /api/health` | живость, без изменений (C-http): `200 {ok: true, db: 'up'}` \| `503 {ok: false, db: 'down'}` |
| `GET /api/health/ready` | `200 {ok: true, db: 'up', migrations: 'ok', queue: 'up'}`; что-то не так — `503`, `ok: false` и `db: 'down'` \| `migrations: 'pending'` (применено меньше, чем в журнале образа) \| `queue: 'down'`. Очередь выключена конфигом (тесты, `push.boss: false`) — `queue: 'off'`, на `ok` не влияет |
| `GET /api/metrics` | `METRICS_TOKEN` пуст — `404 not_found`. Иначе `Authorization: Bearer <METRICS_TOKEN>` (сравнение за постоянное время), нет/не тот — `401 unauthenticated`. Ответ — `200`, `text/plain; version=0.0.4`, формат экспозиции Prometheus |

Caddy проксирует `/api/metrics` как обычный `/api/*`; токен — единственная защита, поэтому он обязателен для включения. Метрики (строка: `имя тип метки`):

```text ops-metrics
planar_http_requests_total counter method,route,status
planar_http_request_duration_seconds histogram method,route
planar_ws_connections gauge path
planar_queue_jobs gauge queue,state
planar_db_size_bytes gauge -
```

- `route` — шаблон маршрута Fastify (`/api/tasks/:id`), не сырой URL; без маршрута — `route="unmatched"`. Запросы к `/api/metrics` и `/api/health*` не считаются.
- Бакеты гистограммы (секунды): `0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2.5,5,10`.
- `planar_ws_connections{path}` — открытые соединения `/ws` и `/collab`.
- `planar_queue_jobs{queue,state}` — `count(*)` из таблицы заданий pg-boss по имени очереди и состоянию pg-boss как есть; при `queue: 'off'` — без строк.
- `planar_db_size_bytes` — `pg_database_size(current_database())`.
- Логи api — pino JSON в stdout; ротация — драйвер docker `json-file` с `max-size: 10m`, `max-file: 5` у всех сервисов `compose.yml`.
