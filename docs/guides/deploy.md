---
type: guide
status: active
module: ops
updated: 2026-10-25
summary: Развёртывание planar на одном VPS - .env, первый запуск, бэкапы и восстановление, обновление, мониторинг, неполадки
related: ["docs/contracts/ops.md", "docs/plan/ops.md", "docs/contracts/core.md"]
---

# Развёртывание planar на VPS

Prod-стек — `compose.yml` в корне репозитория: `postgres`, `api`, `caddy`. Порт api и postgres наружу не публикуется; снаружи только Caddy (80/443). Контракты (переменные, тома, заголовки, формат бэкапа, метрики) — `docs/contracts/ops.md`. Все команды ниже запускаются из корня репозитория на сервере (в примерах — `/opt/planar`).

Что проверено, а что нет: стек, бэкап/восстановление и обновление с откатом прогонялись тестами (`ops/test-backup.sh`, `ops/test-upgrade.sh`, `./dev.sh prod-smoke`) по HTTP на `:80`. **Реальная выдача сертификата ACME для публичного домена не проверялась** — только `caddy validate` Caddyfile с доменом и самоподписанный путь.

## Требования к серверу

- Один VPS с Linux, Docker и compose plugin (`docker compose`), git.
- Node и pnpm на сервере **не нужны**: web собирается внутри образа caddy (`deploy/caddy.Dockerfile`), api — в образе api (`apps/api/Dockerfile`).
- Размеры образов по отчётам OP-1/OP-1b: api ~713 МБ, caddy ~95 МБ (плюс слои сборки и данные). Требований по ОЗУ и CPU в репозитории не зафиксировано; сборка образов нагружает сервер — на слабой машине она идёт заметно дольше.
- Порты 80 и 443 свободны и открыты (переопределяются `HTTP_PORT`, `HTTPS_PORT`).
- Сеть `app` стека — `172.30.0.0/24` (`PLANAR_SUBNET`). Если пересекается с сетями хоста, задайте другую в `.env` до первого запуска.

Получить код:

```bash
git clone <адрес репозитория> /opt/planar && cd /opt/planar
```

## DNS и домен

1. Создайте `A` (и `AAAA`, если есть IPv6) запись домена на адрес сервера.
2. Убедитесь, что 80 и 443 доступны из интернета: Caddy получает сертификат ACME сам и редиректит HTTP на HTTPS.
3. В `.env` задайте `PLANAR_DOMAIN=planar.example.com`. `PUBLIC_URL` по умолчанию `https://$PLANAR_DOMAIN`.

Варианты `PLANAR_DOMAIN`:

| значение | поведение |
|---|---|
| домен | сертификат ACME, редирект HTTP→HTTPS |
| `localhost` или IP | самоподписанный сертификат внутреннего CA Caddy (браузер предупредит) |
| пусто | сайт `:80`, только HTTP; тогда задайте `PUBLIC_URL` явно (например `http://localhost:8080`) и `COOKIE_SECURE=false` |

## Настройка .env

Файл `.env` лежит рядом с `compose.yml`; compose читает его сам. Файл содержит секреты — не коммитьте его (`chmod 600 .env`).

| переменная | по умолчанию | назначение |
|---|---|---|
| `POSTGRES_PASSWORD` | обязательна | пароль пользователя `postgres`; api собирает из неё `DATABASE_URL`. Без неё compose не стартует |
| `PLANAR_DOMAIN` | пусто | домен сайта, см. выше |
| `PUBLIC_URL` | `https://$PLANAR_DOMAIN` | origin для проверки Origin и ссылок |
| `COOKIE_SECURE` | `true` | `false` — только при работе по HTTP |
| `PLANAR_SECRET_KEY` | пусто | 32 байта base64; пусто — функции с секретами отвечают `503 unavailable` |
| `VAPID_PUBLIC_KEY` | пусто | Web Push |
| `VAPID_PRIVATE_KEY` | пусто | Web Push |
| `VAPID_SUBJECT` | пусто | Web Push, `mailto:…` |
| `MAX_UPLOAD_MB` | `50` | лимит загрузки файла |
| `LOG_LEVEL` | `info` | уровень pino |
| `METRICS_TOKEN` | пусто | токен `/api/metrics`; пусто — эндпоинт отвечает `404` |
| `PLANAR_SUBNET` | `172.30.0.0/24` | подсеть сети `app`; api получает её как `TRUST_PROXY` (заголовку `X-Forwarded-For` верят только оттуда) |
| `HTTP_PORT` | `80` | порт хоста для `:80` Caddy |
| `HTTPS_PORT` | `443` | порт хоста для `:443` Caddy |
| `BACKUP_DIR` | `./backups` | каталог архивов бэкапа (читают скрипты `ops/`) |

### Генерация секретов

На сервере с openssl:

```bash
touch .env && chmod 600 .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
echo "PLANAR_SECRET_KEY=$(openssl rand -base64 32)" >> .env
echo "METRICS_TOKEN=$(openssl rand -hex 32)" >> .env
echo "PLANAR_DOMAIN=planar.example.com" >> .env
```

Пару VAPID (ключ P-256) генерирует тот же скрипт, что `vapid()` в `dev.sh`. Node на сервере нет — запустите его в одноразовом контейнере:

```bash
docker run --rm node:24-slim node -e "
  const {privateKey}=require('crypto').generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const j=privateKey.export({format:'jwk'});
  const b=(s)=>Buffer.from(s,'base64url');
  const pub=Buffer.concat([Buffer.from([4]),b(j.x),b(j.y)]).toString('base64url');
  console.log('VAPID_PUBLIC_KEY='+pub+'\nVAPID_PRIVATE_KEY='+j.d+'\nVAPID_SUBJECT=mailto:admin@example.com');
" >> .env
```

Замените `VAPID_SUBJECT` на свой адрес. **`PLANAR_SECRET_KEY` и `POSTGRES_PASSWORD` не меняйте после запуска**: ключ шифрует сохранённые токены (например, GitLab), а пароль уже записан в том postgres. Сохраните `.env` отдельно от бэкапов данных — архивы бэкапа его не содержат.

## Первый запуск и создание владельца

```bash
docker compose up -d --build
docker compose ps
```

Первая сборка занимает несколько минут. Дождитесь готовности:

```bash
curl -fsS https://planar.example.com/api/health/ready
# {"ok":true,"db":"up","migrations":"ok","queue":"up"}
```

Миграции применяет api при старте. Владельца создаёт мастер настройки: пока в системе нет ни одного пользователя, первый вход в UI (`https://<домен>/`) показывает форму создания владельца. То же через API: `GET /api/setup` → `{needed: true}`, затем `POST /api/setup` с `{login, name, password}` → `201`; когда пользователи уже есть, повтор даёт `409 conflict`. Откройте адрес сразу после запуска: пока владельца нет, форму может заполнить любой, кто достучится до сайта.

Проверка стека по умолчанию без сервера: `./dev.sh prod-smoke` поднимает prod-стек в изолированном проекте (`COMPOSE_PROJECT_NAME`, свободные порты), прогоняет вход, задачу, WS, `/collab`, `/f/*`, загрузку файла и гасит стек вместе с томами. Нужен репозиторий с node и pnpm — на prod-сервере запускать не обязательно.

## Бэкапы и восстановление

Тома: `pgdata` и `data` (файлы) — в бэкапе; `caddy_data` и `caddy_config` — нет (Caddy получит сертификаты заново).

### Бэкап

```bash
./ops/backup.sh            # один архив $BACKUP_DIR/planar-<UTC>.tar
./ops/backup.sh --deep     # плюс проверка: имя каждого файла = sha256 содержимого
./ops/backup.sh --rotate-only
```

Архив — tar с `manifest.json`, `db.dump` (`pg_dump -Fc`) и `files.tar` (`files/<ab>/<cd>/<sha256>`). Он пишется как `.partial` и переименовывается после проверки целостности (sha256 частей, `pg_restore -l`, `tar -t`, число файлов); при ошибке `.partial` удаляется, код выхода не 0. Ротация после успешного бэкапа: самый новый архив каждого из 7 последних дней (UTC) и каждой из 4 последних ISO-недель; свежесозданный не удаляется, чужие файлы в каталоге не трогаются.

Расписание. Cron:

```cron
0 3 * * * cd /opt/planar && ./ops/backup.sh >>backups/backup.log 2>&1
```

Или systemd — примеры `ops/systemd/planar-backup.service` и `planar-backup.timer` (ежедневно 03:00, `Persistent=true`; `WorkingDirectory=/opt/planar`, поправьте путь под свой):

```bash
sudo cp ops/systemd/planar-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now planar-backup.timer
```

Рекомендация (скриптами не делается): копируйте архивы за пределы сервера — бэкап на том же диске не защищает от потери диска. Храните отдельно и `.env`.

### Восстановление

Восстановление идёт на **чистый стек** (поднятый по этой инструкции, с тем же `.env`):

```bash
./ops/restore.sh backups/planar-20261025T030000Z.tar
```

Скрипт: поднимает postgres, проверяет целостность архива и `format`/`version`, сверяет число миграций (архив новее кода — отказ), проверяет, что в базе нет пользователей, останавливает api, пересоздаёт базу `planar` (`drop database … with (force)`, `create database`, `pg_restore`), заменяет каталог файлов, запускает api и ждёт `/api/health/ready` (до 120 с). Если в базе уже есть пользователи (`password_hash <> '!'`; системный пользователь автоматизации не считается), скрипт откажет — `--force` перезаписывает:

```bash
./ops/restore.sh --force backups/planar-20261025T030000Z.tar
```

Недостающие миграции api применит при старте. Полный круг (стек → данные → бэкап → снос томов → restore → те же задачи, файлы по sha256, вход) проверяет `ops/test-backup.sh`.

## Обновление

```bash
./ops/upgrade.sh           # собрать из текущей рабочей копии
./ops/upgrade.sh --pull    # сначала git pull --ff-only
```

Что делает по шагам:

1. Бэкап (`ops/backup.sh`); не удался — ничего не тронуто.
2. С `--pull` — `git pull --ff-only`.
3. Ставит метку `:rollback` на текущие образы api и caddy.
4. Собирает новые образы.
5. Применяет миграции новым образом **до** переключения; не прошли — прежний api продолжает работать.
6. Пересоздаёт api и caddy (`--force-recreate`).
7. Ждёт готовности `/api/health/ready` до 120 с.
8. Не готов — возвращает старые образы и пересоздаёт контейнеры; код выхода 1. После успеха метки `:rollback` удаляются.

**Правило миграций.** Миграции при откате не откатываются, поэтому в одном релизе допустимы только расширяющие изменения (новые таблицы, колонки, индексы; без удаления и переименования): старый образ должен работать на новой схеме. Удаляющие изменения — отдельным следующим релизом. Если после неудачного обновления нужно вернуть и данные — восстановите архив, сделанный на шаге 1 (см. «Восстановление»).

Успешный откат и сохранность данных проверяет `ops/test-upgrade.sh`.

## Мониторинг

Эндпоинты без сессии:

| путь | назначение |
|---|---|
| `GET /api/health` | живость: `200 {ok:true, db:'up'}` или `503 {ok:false, db:'down'}` |
| `GET /api/health/ready` | готовность: `200 {ok:true, db:'up', migrations:'ok', queue:'up'}`; иначе `503` и `db:'down'` / `migrations:'pending'` / `queue:'down'`. `queue:'off'` (очередь выключена конфигом) на `ok` не влияет |
| `GET /api/metrics` | Prometheus; нужен `Authorization: Bearer <METRICS_TOKEN>`; токен не задан — `404`, неверный — `401` |

Caddy проксирует `/api/metrics` как любой `/api/*`, поэтому токен — единственная защита: задайте длинный случайный `METRICS_TOKEN`.

Метрики:

| метрика | тип | метки |
|---|---|---|
| `planar_http_requests_total` | counter | `method`, `route`, `status` |
| `planar_http_request_duration_seconds` | histogram | `method`, `route` |
| `planar_ws_connections` | gauge | `path` (`/ws`, `/collab`) |
| `planar_queue_jobs` | gauge | `queue`, `state` |
| `planar_db_size_bytes` | gauge | — |

`route` — шаблон маршрута (`/api/tasks/:id`), не сырой URL. Запросы к `/api/metrics` и `/api/health*` не считаются. Счётчики запросов и WS хранятся в памяти api и сбрасываются при его перезапуске.

Свой Grafana-стек planar не включает. Внешний Prometheus скрейпит так:

```yaml
scrape_configs:
  - job_name: planar
    scheme: https
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ['planar.example.com']
```

Grafana подключается к этому Prometheus как источнику данных (Prometheus или Grafana Cloud). Готовых дашбордов в репозитории нет.

Логи: api пишет pino JSON в stdout; у всех сервисов драйвер docker `json-file`, `max-size: 10m`, `max-file: 5`.

```bash
docker compose logs -f api
docker compose logs --tail 200 caddy postgres
```

Внешняя проверка живости — опрос `/api/health/ready` (код ответа 200).

## Что делать при проблемах

| симптом | что проверить |
|---|---|
| `compose up` падает с «задайте POSTGRES_PASSWORD» | переменная не задана в `.env` |
| `/api/health/ready` → `503`, `db: 'down'` | `docker compose ps postgres`, `docker compose logs postgres`; на сильно загруженном хосте postgres может долго становиться healthy (healthcheck до 60 попыток по 5 с) |
| `ready` → `migrations: 'pending'` | применено меньше миграций, чем в образе: `docker compose logs api`; обычно после сбоя миграции при старте |
| `ready` → `queue: 'down'` | pg-boss не отвечает: логи api, состояние postgres |
| api не стартует / перезапускается | `docker compose logs api`; частые причины — неверный `POSTGRES_PASSWORD` относительно уже созданного тома, ошибка конфигурации |
| сертификат не выдан, браузер ругается | DNS `A`/`AAAA` указывает на сервер; 80 и 443 открыты (ACME-проверка идёт по ним); `docker compose logs caddy`. Напоминание: выдача ACME в репозитории не проверялась |
| вход не держится, ошибки Origin | `PUBLIC_URL` должен совпадать с адресом в браузере; по HTTP — `COOKIE_SECURE=false` |
| функции с секретами дают `503 unavailable` | не задан `PLANAR_SECRET_KEY` |
| `/api/metrics` → `404` / `401` | не задан `METRICS_TOKEN` / неверный токен |
| `restore.sh` отказывает | «архив не читается» или целостность — архив повреждён, возьмите другой; «архив новее кода» — обновите код до версии архива; «в базе уже есть пользователи» — `--force`; «api не стал готов» — логи api |
| `upgrade.sh` завершился с кодом 1 | `новая версия не готова` — образы возвращены, смотрите `docker compose logs api` и чините релиз; `миграции не прошли` — прежний api работает; `бэкап не удался` — ничего не менялось |
| `upgrade.sh` откатил образы, но схема уже новая | миграции не откатываются; старый образ рассчитан на расширяющую схему (правило миграций). Нужен возврат данных — `ops/restore.sh --force` архивом с шага 1 |
| подсеть `172.30.0.0/24` занята | задайте другую `PLANAR_SUBNET` в `.env` и пересоздайте стек |
