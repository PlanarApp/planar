---
title: Установка
description: Развёртывание planar на VPS
---

# Установка (VPS)

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
git clone https://gitlab.com/planarhq/planar.git /opt/planar && cd /opt/planar
```

## DNS и домен

1. Создайте `A` (и `AAAA`, если есть IPv6) запись домена на адрес сервера.
2. Убедитесь, что 80 и 443 доступны из интернета: Caddy получает сертификат ACME сам и редиректит HTTP на HTTPS.
3. В `.env` задайте `PLANAR_DOMAIN=planar.example.com`. `PUBLIC_URL` по умолчанию `https://$PLANAR_DOMAIN`.

Варианты `PLANAR_DOMAIN`:

| значение           | поведение                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| домен              | сертификат ACME, редирект HTTP→HTTPS                                                                                |
| `localhost` или IP | самоподписанный сертификат внутреннего CA Caddy (браузер предупредит)                                               |
| пусто              | сайт `:80`, только HTTP; тогда задайте `PUBLIC_URL` явно (например `http://localhost:8080`) и `COOKIE_SECURE=false` |

## Первый запуск и создание владельца

```bash
docker compose up -d
docker compose ps
```

`compose.yml` скачивает готовые образы `${PLANAR_REGISTRY:-registry.gitlab.com/planarhq/planar}/{api,caddy}:${PLANAR_VERSION:-latest}`. Чтобы собрать из исходников, используйте `compose.build.yml` (`docker compose -f compose.yml -f compose.build.yml up -d --build`); сборка занимает несколько минут. Дождитесь готовности:

```bash
curl -fsS https://planar.example.com/api/health/ready
# {"ok":true,"db":"up","migrations":"ok","queue":"up"}
```

Миграции применяет api при старте. Владельца создаёт мастер настройки: пока в системе нет ни одного пользователя, первый вход в UI (`https://<домен>/`) показывает форму создания владельца. То же через API: `GET /api/setup` → `{needed: true}`, затем `POST /api/setup` с `{login, name, password}` → `201`; когда пользователи уже есть, повтор даёт `409 conflict`. Откройте адрес сразу после запуска: пока владельца нет, форму может заполнить любой, кто достучится до сайта.

Проверка стека по умолчанию без сервера: `./dev.sh prod-smoke` поднимает prod-стек в изолированном проекте (`COMPOSE_PROJECT_NAME`, свободные порты), прогоняет вход, задачу, WS, `/collab`, `/f/*`, загрузку файла и гасит стек вместе с данными (временный `PLANAR_DATA_DIR`). Нужен репозиторий с node и pnpm — на prod-сервере запускать не обязательно.
