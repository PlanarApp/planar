# ai-runner

Узкий HTTP-сервис между api и docker: запускает контейнеры agent-действий ИИ. Контракт — `docs/contracts/ai10.md` §1 (`ai10-runner` v1). Единственный сервис со сторонним доступом к `docker.sock`; клиент (api) не может влиять на `HostConfig` (без Binds, Privileged, PidMode; `CapDrop ALL`, `no-new-privileges`, read-only rootfs, свои лимиты).

## Запуск

Сервисы `ai-runner` и `squid` в `compose.yml` лежат под профилем `ai` и по умолчанию не поднимаются:

```sh
docker compose --profile ai up -d
```

Образ `ai-runner` собирается из `apps/ai-runner/Dockerfile` (контекст — корень репозитория).

## Переменные окружения

Пример `.env`:

```sh
AI_RUNNER_TOKEN=длинный-случайный-секрет     # обязателен у ai-runner; api берёт тот же
AI_RUNNER_IMAGES=registry.example/agent:1     # allowlist образов, через запятую, точное совпадение
AI_RUNNER_URL=http://ai-runner:8080           # для api: включает запуск agent-действий
AI_AGENT_IMAGE=registry.example/agent:1       # для api: какой образ запускать
AI_AGENT_MAX_REPLICAS=2                       # для api: сколько прогонов одновременно
```

Только для ai-runner (значения по умолчанию в скобках):

| Переменная                | Назначение                                 |
| ------------------------- | ------------------------------------------ |
| `AI_RUNNER_MAX_CPUS`      | потолок CPU на прогон (2)                  |
| `AI_RUNNER_MAX_MEMORY_MB` | потолок памяти, МБ (4096)                  |
| `AI_RUNNER_MAX_PIDS`      | потолок процессов (512)                    |
| `AI_RUNNER_AGENT_NETWORK` | сеть контейнеров агентов (`planar_agents`) |
| `DOCKER_HOST_SOCKET`      | сокет docker (`/var/run/docker.sock`)      |
| `PORT`                    | порт (8080)                                |

## Сети и egress

- `runner` (internal) — api ↔ ai-runner.
- `agents` (internal, имя `planar_agents`) — контейнеры агентов, api и squid. Прямого выхода в интернет нет.
- Выход наружу — только через `squid` (`HTTP_PROXY=http://squid:3128`), allowlist доменов — `deploy/squid.conf` (git, npm, github, gitlab). Чтобы разрешить ещё домен — добавить его в `acl allowed_domains` и перезапустить squid.

## Ограничения

- `/work` — tmpfs (рабочий каталог агента). Контекст лежит вне tmpfs, в `/context/context.json` (контракт ai10 v1.1): кладётся в созданный контейнер до старта через `putArchive` с `path=/` (tar: каталог `context/` и файл в нём) — иначе tmpfs скрыл бы файл. На реальном docker не проверено.
- Внутри runner'а нет учёта прогонов: состояние — только метки docker; «жнец» зависших контейнеров — на стороне api.
