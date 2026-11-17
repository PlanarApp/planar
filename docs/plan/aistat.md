---
type: plan
status: closed
module: aistat
updated: 2026-11-17
summary: Статус ИИ отдельно от статуса задачи, «Отвечает ИИ» под комментарием, затраты ИИ по задаче и отчёт (PLNRAPP-399…403)
related: ["docs/plan/ai10.md"]
---

# Модуль aistat — статус и затраты ИИ

## 1. Цель
PLNRAPP-399…403. Статус ИИ — отдельная строка в форме задачи и отдельная колонка/фильтр списка; индикатор ответа ИИ — под комментарием, на который ИИ отвечает; затраты ИИ (время, токены, $) по задаче и отчёт. Всё — только при модуле `ai` в проекте. План в Planar: документ «План: статус и затраты ИИ, автопилот» (`01a1e954-2301-7a32-8b4d-c2e64b37bf81`). Не входит: координатор подзадач (PLNRAPP-404), автопилот (PLNRAPP-405) — следующая фаза.

## 2. Решения пользователя (2026-11-17)
- Статус ИИ вычисляется из `ai_runs` — не метками и не полем задачи. Фильтр списка — по тому же агрегату.
- «Ждёт» = новое состояние `queued` в `ai_runs` (строка создаётся при постановке в очередь); `waiting_human` — «Ждёт ответа».
- Затраты — агрегат из `ai_runs` (+ колонка `finished_at`), кастомные поля не используем.
- Видно только при `enabledForProject('ai', projectId)` на вебе и `'ai' = any(p.modules)` в API.
- Демо-сид `apps/api/src/db/seed-demo.ts` обновить (запуски со статусами и затратами), формат проверяет `apps/api/test/seed-demo.test.ts`.

## 3. Что есть в коде (факты)
- Состояния прогона: `modules/ai/shared/index.ts:216` (`running | waiting_human | done | failed | cancelled`); активность `:257-264`, статус для списка `:273-280`.
- Эндпоинты: `modules/ai/api/controller.ts` — `GET api/ai/activity/tasks/:taskId` (~234), `GET api/ai/status/projects/:projectId` (~266, отдаёт только running/failed). Тест — `apps/api/test/ai/task-status.test.ts`.
- Очередь pg-boss: `modules/ai/api/run.ts:84-91` (`keyOf`, singletonKey, `startAfter: 5`), обработчик ~430+, `item_id` ~496/521, ответ комментарием `parentId: run.item.id` ~1015.
- Схема `ai_runs`: `modules/ai/api/schema.ts:104-157` (`input_tokens`, `output_tokens`, `cost`, `started_at`, `updated_at`; `finished_at` нет). Цена — `costOf` в `modules/ai/api/llm.ts:40`; агент — `agent.controller.ts:280-283`, жнец `agent.ts`.
- Веб: `apps/web/src/modules/activity.ts` (`activityOf`, `useActivity`, `useProjectActivity`, `TASK_ACTIVITY`, `ACTIVITY_GRACE_MS`); `modules/ai/web/index.ts:20-38` — источники activity; `apps/web/src/task/WorkStatus.vue`, `task/AiStatusIcon.vue`, `views/TaskAiStatus.vue` (в `views/list/Row.vue`, `views/list/TaskCard.vue`).
- Форма задачи: `apps/web/src/task/TaskDetail.vue:591-606` — кольцо `work-ring` на «Статусе» и `WorkStatus` рядом.
- Комментарии: `apps/web/src/task/CommentItem.vue:60-70, 162-169` (индикатор в начале тела комментария-триггера), `CommentThread.vue:120-133` (подтреды).
- Отчёты: вкладка группы `reports` (`groupTabs: [{ tab: 'reports' }]`, пример `modules/time/web/index.ts:22`, `GroupTime.vue`).
- Включение модуля: `apps/web/src/modules/registry.ts` (`enabledForProject`, `useExtensions`); API `apps/api/src/modules/enabled.ts`.

## 4. Задачи
- **AST-1 = PLNRAPP-399** (волна 1). Состояние `queued`: строка `ai_runs` при постановке в очередь (обработчик берёт её и переводит в `running`; singleton — одна `queued` на ключ), миграция. Эндпоинты статуса/активности отдают `queued` и последний `done`. Строка «ИИ» в свойствах задачи под «Статусом» (иконка + Ждёт / Ждёт ответа / Работает / Готово / Ошибка, клик — панель запусков), кольцо и `WorkStatus` со строки «Статус» убрать; только при модуле ai и наличии запусков. i18n ru/en. Тесты API и веба, демо-сид.
- **AST-2 = PLNRAPP-400** (волна 1). Индикатор `WorkStatus` в комментарии — из начала тела в конец, псевдо-ответом под комментарием-триггером (для триггера-ответа — внутри его подтреда). Только веб, тест.
- **AST-3 = PLNRAPP-402** (волна 1, миграция — после AST-1, номера не пересекать). `ai_runs.finished_at` (ставится при переходе в done/failed/cancelled, включая жнеца и отмену). Агрегат затрат по задаче (время = Σ(finished_at − started_at), токены, $) — в эндпоинте статуса проекта и активности задачи; в строке «ИИ» формы — сумма (если AST-1 ещё не слит — после него). Демо-сид.
- **AST-4 = PLNRAPP-401** (волна 2, после AST-1/AST-3). Колонка списка «ИИ» (включаемая, как прочие колонки) вместо значка в строке; колонки «ИИ: $», «ИИ: время»; фильтр «Статус ИИ»; карточка доски — статус ИИ отдельно от статуса. Только при модуле ai. Тесты веба.
- **AST-5 = PLNRAPP-403** (волна 2, после AST-3). Вкладка «Отчёты» модуля ai: затраты (время, токены, $) за период с группировкой по задачам / дням; эндпоинт API с проверкой прав и модуля. Если появится REST v1 — инструмент MCP и строка `PARITY`. Демо-сид, тесты.

## 5. Волны
1. AST-1, AST-2, AST-3 (AST-3 стартует от слитого AST-1, если пересекаются схема/эндпоинты — по решению координатора последовательно).
2. AST-4, AST-5.
Затем полный `pnpm test` + `pnpm -s lint` в копии модуля, `deliver aistat --into mr/aistat`. MR — один, ключи PLNRAPP-399…403 в описании.

## 6. Условия остановки
- Конфликт миграций с `main`, не решаемый перенумерацией.
- Нужна правка контейнера агента (`docker/ai-agent`, `apps/ai-runner`) — вне модуля.
- Неясно, как показывать «Ждёт», если pg-boss job уже взят, а строка ещё `queued` — решить по коду, записать в контракт.

## Решения пользователя
