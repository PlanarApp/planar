# Planar

Planar — быстрый и простой трекер задач для команд. Локальная копия данных в браузере делает интерфейс мгновенным и рабочим без сети. Один экземпляр — одно рабочее пространство. Разворачивается у себя через Docker Compose.

<!-- screenshots -->

## Возможности

- Local-first синхронизация: реплика в IndexedDB, оптимистичные мутации, журнал изменений на сервере (`changes`) и «пинок» по WebSocket. Офлайн-режим работает за счёт очереди неподтверждённых мутаций, которые заново применяются после каждого pull.
- Устанавливаемое PWA (Vue 3 + Vite), раскладки для десктопа и мобильных.
- Задачи, подзадачи, чек-листы, метки, исполнители, комментарии, вложения, уведомления и Web Push.
- REST API (`/api/v1`) и встроенный MCP-сервер (`/mcp`, Streamable HTTP) с личными API-токенами (`plnr_...`, права `read` или `write`).
- Модули: функции — модули в `modules/*` (например `sprints`, `time`, `forms`, `automations`, `webhooks`, `dashboards`, `docs`, `gitlab`). Модули включаются для экземпляра; плагины можно встраивать как страницы в песочнице (см. `examples/plugin-hello`).
- Self-host: `docker compose` с PostgreSQL 18 (pgvector), API и Caddy (автоматический TLS, статика).
- Бэкапы и восстановление: скрипты в `ops/` (`backup.sh`, `restore.sh`, `upgrade.sh`).

## Установка

```bash
git clone https://gitlab.com/planarhq/planar.git
cd planar
cp .env.example .env   # затем задайте POSTGRES_PASSWORD, PLANAR_DOMAIN и остальное
docker compose up -d
```

`.env.example` рассчитан на разработку; для реального сервера задайте переменные из [docs/guides/deploy.md](docs/guides/deploy.md) (домен, секреты, ключи VAPID, бэкапы). Первый заход на сайт показывает форму создания владельца — откройте адрес сразу после запуска. Текущий `compose.yml` собирает образы локально (`docker compose up -d --build`).

Подключение ИИ-агентов по MCP: [docs/guides/mcp.md](docs/guides/mcp.md).

## Ссылки

- Репозиторий: https://gitlab.com/planarhq/planar (зеркало: https://github.com/PlanarApp/planar)
- Образы: `registry.gitlab.com/planarhq/planar/{api,caddy}`, `ghcr.io/planarapp/planar-{api,caddy}`
- Планируются (домены ещё не куплены): https://planarhq.com, https://docs.planarhq.com, https://demo.planarhq.com
- Вклад: [CONTRIBUTING.md](CONTRIBUTING.md) | Безопасность: [SECURITY.md](SECURITY.md) | История изменений: [CHANGELOG.md](CHANGELOG.md)
- English version: [README.md](README.md)

## Лицензия

Apache License 2.0, см. [LICENSE](LICENSE) и [NOTICE](NOTICE). Имя и логотип Planar лицензией не покрываются, см. [TRADEMARK.md](TRADEMARK.md).
