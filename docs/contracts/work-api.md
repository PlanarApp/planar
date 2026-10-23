---
type: reference
status: active
module: work
updated: 2026-10-23
summary: Контракты work, часть 2 — C-modules v5 и v6 (enqueue, SDK, настройки модулей, правки collab), REST v1 и MCP (WK-5)
related: ["docs/contracts/work.md", "docs/contracts/core-api-v1.md", "docs/contracts/core.md"]
---

# Контракты модуля work, часть 2

## C-modules v7 (поправка SDK по contract collab)
v7 = v6 + полный перечень значений SDK `@planar/web/modules` (сверка с collab.md §X-core п. 6; при слиянии ветки нельзя терять ни одно имя). Контрактный тест — `apps/web/src/__contract__/sdk.contract.test.ts` (блок `sdk-exports` ниже).
- Обязательные (есть всегда):
```text sdk-exports=required
defineWebModule mutate newId rankBetween useQuery db useTask useProjectTasks useSpaces useProject useStatuses useMembers useLabels openTask useI18n i18n useWeekStart useRouter useSearch Editor uploadFile api ApiError onMutationError FilterBuilder localToday matchFilter useSession useCycles
```
- Вместе с клиентом синхронизации (C-sync v2, collab): если `apps/web/src/sync` экспортирует имя — SDK обязан его реэкспортировать:
```text sdk-exports=with-sync
sendTyping onTyping
```
Сверка остального §X-core с v6: п. 1 — в C-modules только тип `members` (поведение — C-sync v2 collab), п. 2–3 — C-sync v2 и C-schema (collab), п. 4–5 — в v6, п. 6 — этот перечень.

## C-modules v6 (WK-14)
v6 = v5 (ниже) + правки ядра от collab (docs/contracts/collab.md §X-core в feature/collab, п. 1 — только тип, п. 4–6). Владелец C-modules — work; collab присылает правки главной строкой «contract: …», work вносит их следующей версией.
- `EntityMeta.members?: { entity: string; key: string; container: string; via: string }` — только тип и проверка формы при загрузке модулей; поведение видимости `space|members` — C-sync v2 (collab).
- `BackendModuleManifest.canReadFile?(q: Q, userId: string, sha256: string): Promise<boolean>` — `GET /files/:sha256` разрешён, если обычная проверка ядра запрещает, но `true` вернул любой включённый модуль (collab.md §X-core п. 4).
- web: вид расширений `search` (`EXTENSION_KINDS` += `'search'`): `SearchDef = { id: string; label: LocalizedText; search(q: string, limit: number): Promise<{ id: string; title: string; subtitle?: string; icon?: Component; to: RouteLocationRaw }[]> }`; палитра Cmd+K показывает группы включённых модулей под задачами, ошибка/таймаут поиска модуля не ломает палитру.
- SDK `@planar/web/modules` += `Editor` (`apps/web/src/task/editor/Editor.vue`, пропсы как есть), `uploadFile` (`apps/web/src/api/files.ts`), JSON-хелперы `apps/web/src/api/http.ts` (те же имена), `onMutationError` (C-client), `useSearch` (поиск задач, `apps/web/src/command/search.ts`). `sendTyping`/`onTyping` — вместе с C-sync v2 у collab.
- Тесты модулей (`*.test.ts`) могут импортировать `apps/web/src` относительным путём для настройки клиента; код модулей — только SDK и server-kit.

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
