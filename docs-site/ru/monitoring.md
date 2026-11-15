---
title: Мониторинг и неполадки
description: Здоровье, метрики, логи, проблемы
---

# Мониторинг

Эндпоинты без сессии:

| путь                    | назначение                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`       | живость: `200 {ok:true, db:'up'}` или `503 {ok:false, db:'down'}`                                                                                                                                    |
| `GET /api/health/ready` | готовность: `200 {ok:true, db:'up', migrations:'ok', queue:'up'}`; иначе `503` и `db:'down'` / `migrations:'pending'` / `queue:'down'`. `queue:'off'` (очередь выключена конфигом) на `ok` не влияет |
| `GET /api/metrics`      | Prometheus; нужен `Authorization: Bearer <METRICS_TOKEN>`; токен не задан — `404`, неверный — `401`                                                                                                  |

Caddy проксирует `/api/metrics` как любой `/api/*`, поэтому токен — единственная защита: задайте длинный случайный `METRICS_TOKEN`.

Метрики:

| метрика                                | тип       | метки                       |
| -------------------------------------- | --------- | --------------------------- |
| `planar_http_requests_total`           | counter   | `method`, `route`, `status` |
| `planar_http_request_duration_seconds` | histogram | `method`, `route`           |
| `planar_ws_connections`                | gauge     | `path` (`/ws`, `/collab`)   |
| `planar_queue_jobs`                    | gauge     | `queue`, `state`            |
| `planar_db_size_bytes`                 | gauge     | —                           |

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

| симптом                                           | что проверить                                                                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compose up` падает с «задайте POSTGRES_PASSWORD» | переменная не задана в `.env`                                                                                                                                                                          |
| `/api/health/ready` → `503`, `db: 'down'`         | `docker compose ps postgres`, `docker compose logs postgres`; на сильно загруженном хосте postgres может долго становиться healthy (healthcheck до 60 попыток по 5 с)                                  |
| `ready` → `migrations: 'pending'`                 | применено меньше миграций, чем в образе: `docker compose logs api`; обычно после сбоя миграции при старте                                                                                              |
| `ready` → `queue: 'down'`                         | pg-boss не отвечает: логи api, состояние postgres                                                                                                                                                      |
| api не стартует / перезапускается                 | `docker compose logs api`; частые причины — неверный `POSTGRES_PASSWORD` относительно базы, уже лежащей в `./data`, ошибка конфигурации                                                                |
| сертификат не выдан, браузер ругается             | DNS `A`/`AAAA` указывает на сервер; 80 и 443 открыты (ACME-проверка идёт по ним); `docker compose logs caddy`. Напоминание: выдача ACME в репозитории не проверялась                                   |
| вход не держится, ошибки Origin                   | `PUBLIC_URL` должен совпадать с адресом в браузере; по HTTP — `COOKIE_SECURE=false`                                                                                                                    |
| функции с секретами дают `503 unavailable`        | не задан `PLANAR_SECRET_KEY`                                                                                                                                                                           |
| `/api/metrics` → `404` / `401`                    | не задан `METRICS_TOKEN` / неверный токен                                                                                                                                                              |
| `restore.sh` отказывает                           | «архив не читается» или целостность — архив повреждён, возьмите другой; «архив новее кода» — обновите код до версии архива; «в базе уже есть пользователи» — `--force`; «api не стал готов» — логи api |
| `upgrade.sh` завершился с кодом 1                 | `новая версия не готова` — образы возвращены, смотрите `docker compose logs api` и чините релиз; `миграции не прошли` — прежний api работает; `бэкап не удался` — ничего не менялось                   |
| `upgrade.sh` откатил образы, но схема уже новая   | миграции не откатываются; старый образ рассчитан на расширяющую схему (правило миграций). Нужен возврат данных — `ops/restore.sh --force` архивом с шага 1                                             |
| подсеть `172.30.0.0/24` занята                    | задайте другую `PLANAR_SUBNET` в `.env` и пересоздайте стек                                                                                                                                            |
