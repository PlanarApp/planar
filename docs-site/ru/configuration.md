---
title: Настройка .env
description: Переменные окружения
---

# Настройка .env

Файл `.env` лежит рядом с `compose.yml`; compose читает его сам. Файл содержит секреты — не коммитьте его (`chmod 600 .env`).

| переменная          | по умолчанию                          | назначение                                                                                                                                                                                                        |
| ------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | обязательна                           | пароль пользователя `postgres`; api собирает из неё `DATABASE_URL`. Без неё compose не стартует                                                                                                                   |
| `PLANAR_DOMAIN`     | пусто                                 | домен сайта, см. выше                                                                                                                                                                                             |
| `PUBLIC_URL`        | `https://$PLANAR_DOMAIN`              | origin для проверки Origin и ссылок                                                                                                                                                                               |
| `COOKIE_SECURE`     | `true`                                | `false` — только при работе по HTTP                                                                                                                                                                               |
| `PLANAR_SECRET_KEY` | пусто                                 | 32 байта base64; пусто — функции с секретами отвечают `503 unavailable`                                                                                                                                           |
| `VAPID_PUBLIC_KEY`  | пусто                                 | Web Push                                                                                                                                                                                                          |
| `VAPID_PRIVATE_KEY` | пусто                                 | Web Push                                                                                                                                                                                                          |
| `VAPID_SUBJECT`     | пусто                                 | Web Push, `mailto:…`                                                                                                                                                                                              |
| `MAX_UPLOAD_MB`     | `50`                                  | лимит загрузки файла                                                                                                                                                                                              |
| `LOG_LEVEL`         | `info`                                | уровень pino                                                                                                                                                                                                      |
| `METRICS_TOKEN`     | пусто                                 | токен `/api/metrics`; пусто — эндпоинт отвечает `404`                                                                                                                                                             |
| `PLANAR_SUBNET`     | `172.30.0.0/24`                       | подсеть сети `app`; api получает её как `TRUST_PROXY` (заголовку `X-Forwarded-For` верят только оттуда)                                                                                                           |
| `HTTP_PORT`         | `80`                                  | порт хоста для `:80` Caddy                                                                                                                                                                                        |
| `HTTPS_PORT`        | `443`                                 | порт хоста для `:443` Caddy                                                                                                                                                                                       |
| `SETUP_TOKEN`       | пусто                                 | задан — `POST /api/setup` (создание владельца) принимается только с заголовком `X-Setup-Token` с этим значением, иначе `403`; экран настройки покажет поле «Setup token». Пусто — открыто до первого пользователя |
| `DB_POOL_MAX`       | `10`                                  | максимум соединений в пуле Postgres, целое ≥ 1; иное — ошибка конфигурации при старте                                                                                                                             |
| `DEMO_MODE`         | `false`                               | `true` — публичное демо: плашка, вход «Try the demo», без исходящих email/push/webhooks, `MAX_UPLOAD_MB` по умолчанию 2. Для обычной установки не включайте                                                       |
| `DEMO_RESET_HOURS`  | `24`                                  | только текст плашки демо; сам сброс делает cron                                                                                                                                                                   |
| `PLANAR_REGISTRY`   | `registry.gitlab.com/planarhq/planar` | реестр образов api и caddy                                                                                                                                                                                        |
| `PLANAR_VERSION`    | `latest`                              | тег образов                                                                                                                                                                                                       |
| `BACKUP_DIR`        | `./backups`                           | каталог архивов бэкапа (читают скрипты `ops/`)                                                                                                                                                                    |

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
