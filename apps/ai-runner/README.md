# ai-runner

Узкий HTTP-сервис между api и docker: запускает контейнеры agent-действий ИИ. Контракт — `docs/contracts/ai10.md` §1 (`ai10-runner` v1). Единственный сервис со сторонним доступом к `docker.sock`; клиент (api) не может влиять на `HostConfig` (без Binds, Privileged, PidMode; `CapDrop ALL`, `no-new-privileges`, read-only rootfs, свои лимиты).

## Запуск

Сервисы `ai-runner` и `squid` в `compose.yml` лежат под профилем `ai` и по умолчанию не поднимаются:

```sh
docker compose --profile ai up -d
```

Образ `ai-runner` собирается из `apps/ai-runner/Dockerfile` (контекст — корень репозитория). Оба образа — `ai-runner` и агент `ai-agent` (`docker/ai-agent`) — CI публикует в реестр `registry.gitlab.com/planarhq/planar/`.

### Локально (dev)

```sh
docker build -t planar-ai-agent:1 docker/ai-agent   # образ агента, один раз (~3,2 ГБ)
./dev.sh up-ai                                       # dev-стек + ai-runner + squid (compose.dev.ai.yml)
```

`ai-runner` собирается из исходников, api получает `AI_RUNNER_URL` и токен (по умолчанию `dev-runner-token`). Ключ провайдера — в «Настройки → ИИ»: без него ни llm-действия, ни LLM-прокси агентов не работают. `./dev.sh down` гасит и ИИ-сервисы.

## Переменные окружения

Пример `.env`:

```sh
PLANAR_AI=on                                  # для api: модуль ai можно включить в настройках воркспейса
AI_RUNNER_TOKEN=длинный-случайный-секрет     # обязателен у ai-runner; api берёт тот же
AI_RUNNER_IMAGES=registry.gitlab.com/planarhq/planar/ai-agent:1.4   # allowlist образов, через запятую, точное совпадение
AI_RUNNER_URL=http://ai-runner:8080           # для api: включает запуск agent-действий
AI_AGENT_IMAGE=registry.gitlab.com/planarhq/planar/ai-agent:1.4     # для api: какой образ запускать
AI_AGENT_MAX_REPLICAS=2                       # для api: сколько прогонов одновременно
```

Только для ai-runner (значения по умолчанию в скобках):

| Переменная                | Назначение                                     |
| ------------------------- | ---------------------------------------------- |
| `AI_RUNNER_MAX_CPUS`      | потолок CPU на прогон (2)                      |
| `AI_RUNNER_MAX_MEMORY_MB` | потолок памяти, МБ (4096)                      |
| `AI_RUNNER_MAX_PIDS`      | потолок процессов (512)                        |
| `AI_RUNNER_TMPFS_MB`      | размер tmpfs `/work`, МБ (256, не больше 2048) |
| `AI_RUNNER_AGENT_NETWORK` | сеть контейнеров агентов (`planar_agents`)     |
| `DOCKER_HOST_SOCKET`      | сокет docker (`/var/run/docker.sock`)          |
| `PORT`                    | порт (8080)                                    |

## Сети и egress

- `runner` (internal) — api ↔ ai-runner.
- `agents` (internal, имя `planar_agents`) — контейнеры агентов, api и squid. Прямого выхода в интернет нет.
- Выход наружу — только через `squid` (`HTTP_PROXY=http://squid:3128`), конфиг — `deploy/squid.conf`: агентам открыт весь интернет (любые домены и порты, включая приватные сети), запросы пишутся в `access_log` squid.

## Ограничения

- `/work` — tmpfs (рабочий каталог агента, размер `AI_RUNNER_TMPFS_MB`). Контекст — `/context/context.json` в анонимном томе `/context` (rootfs read-only): кладётся в созданный контейнер до старта через `putArchive` с `path=/context`; том удаляется вместе с контейнером (`AutoRemove`, DELETE с `v=true`). Проверено на docker 29 (alpine:3.20).
- Внутри runner'а нет учёта прогонов: состояние — только метки docker; «жнец» зависших контейнеров — на стороне api.
