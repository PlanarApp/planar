---
type: reference
status: active
module: work
updated: 2026-10-23
summary: Контракты work, часть 2 — C-modules v5 (CoreServices.enqueue, SDK FilterBuilder и router, страницы настроек модулей), REST v1 и MCP (WK-5)
related: ["docs/contracts/work.md", "docs/contracts/core-api-v1.md", "docs/contracts/core.md"]
---

# Контракты модуля work, часть 2

## C-modules v5 (WK-12)
v5 — дополнения к v4 (docs/contracts/work.md §C-modules v4), обратно совместимы:
- `CoreServices.enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>` — постановка задачи pg-boss вне транзакции мутации (контроллеры модулей: ping, ручной повтор, старт импорта). `push.boss: false` — ничего не делает.
- SDK `@planar/web/modules` += `FilterBuilder` (компонент конструктора фильтра ядра, `v-model: Filter`, пропсы `{ projectId: string }`; правила полей и `cycle` — как в сохранённых видах), `useRouter` (vue-router; модуль переходит по маршрутам без `location.assign`), `useCycles(projectId?)` → циклы для `FilterCtx.cycles` (пусто, если модуль sprints выключен).
- Страницы настроек модулей (`settings` манифеста, C-ui `SettingsPageDef`) показываются в `/settings/:section` (`section` = `<moduleId>:<id>`), в меню настроек — после встроенных разделов, только включённых модулей. `SettingsPageDef` += `adminOnly?: boolean` — пункт и страница скрыты от не-админов инстанса (сервер всё равно проверяет права).
- automations (сервер): для условий с `cycle` — циклы проекта SQL-запросом к `sprints_cycles` (модуль sprints включён), иначе `cycles` не передаются и правила с `'current'` пропускаются (F-filter v2).

## REST и MCP (WK-5)
Дополнение `docs/contracts/core-api-v1.md` (форма ответов, пагинация, ошибки, права токена — как там). Пути модулей при выключенном модуле → `404 module_disabled`.

| метод и путь | вход → выход |
|---|---|
| `GET /api/v1/tasks/:task/links` | → `{data: link[]}`; `link` — строка `taskLinks` |
| `POST /api/v1/tasks/:task/links` | `{target (id или key), kind}` → `201 {data: link}` (`link.create`) |
| `DELETE /api/v1/links/:id` | → `204` |
| `GET /api/v1/time-entries?taskId=&userId=&from=&to=` | → список `timeEntries` (`userId=me`; `from`/`to` — ts по `startedAt`) |
| `POST /api/v1/time-entries` | `{task, startedAt, durationSec, note?}` → `201` запись (`time.log`) |
| `GET /api/v1/timer` | → `{data: timeEntry \| null}` — идущий таймер пользователя |
| `POST /api/v1/timer/start` | `{task}` → `201 {data: timeEntry}` |
| `POST /api/v1/timer/stop` | → `{data: timeEntry \| null}` |
| `GET /api/v1/projects/:id/cycles` | → `{data: cycle[]}` по `number` убыв., без пагинации |
| `GET /api/v1/projects/:id/cycles/current` | → `{data: cycle \| null}` |
| `GET /api/v1/projects/:id/automations` | → `{data: rule[]}` (чтение) |

MCP — новые инструменты: `link_tasks {task, target, kind}`, `log_time {task, minutes, date?: YYYY-MM-DD, note?}` (начало — 09:00 UTC даты, по умолчанию сегодня), `start_timer {task}`, `stop_timer {}`, `current_sprint {projectId}` → цикл и его задачи (компактно). Запись (`link_tasks`, `log_time`, `start_timer`, `stop_timer`) — нужен `write`.
