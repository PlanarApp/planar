---
type: plan
status: closed
module: ai6
updated: 2026-11-12
summary: ИИ-6 (PLNRAPP-171) — мониторинг ИИ: вкладка «ИИ» в задаче, «Задачи ИИ» для админов, лимиты, выключатель
related: ["docs/plan/ai6.md", "modules/ai/api/run.ts", "/root/planar-ai6/build/ai-plan.md"]
---

# ai6 — мониторинг ИИ

## 1. Цель
Источник: задача PLNRAPP-171, `build/ai-plan.md` §9 «Мониторинг». Модуль `modules/ai` (ai_runs, ai_run, бот, флоу прогона) уже в main. Runner (ИИ-10) не сделан: «загрузка реплик против лимитов» = число прогонов `running`/`waiting_human` и суточные токены/деньги против лимитов, без реплик.

## 2. Решения (coordinator, пользователь спит)
- D1. Миграция — 0053 (0052 занята MR !161: `ai_harness_keys`, `ai_harness_packs`; их не трогаем).
- D2. REST v1 не трогаем: эндпоинты `api/ai/*` в контроллере модуля (сессия, как `connections`). MCP/PARITY не нужны: агенты мониторингом не пользуются.
- D3. Лимит «на прогон» = существующий `ai_actions.maxOutputTokens` плюс `chainDepth` (`MAX_CHAIN`), новое — только суточные на проект и перезапуски.
- D4. Перезапуск = новый `ai_runs`-прогон теми же данными (`AiRunData` восстанавливается из строки), `restart_of` = исходный прогон; цепочка перезапусков ≤ `MAX_RESTARTS = 3`.
- D5. Выключатель — таблица `ai_settings` (одна строка): `enabled`; выключен → новые прогоны не стартуют (прогон завершается `failed` с логом «ИИ выключен администратором»), активные не трогаем; кнопка «Остановить» отменяет отдельный.
- D6. Лимиты инстанса — env `PLANAR_AI_DAILY_TOKENS`, `PLANAR_AI_DAILY_COST` (по умолчанию не заданы = без лимита) на проект в сутки; проектные — таблица `ai_project_limits`, перекрывают env (меньшее из двух не берём: проектное значение главнее, `null` — наследует env). Лимиты — только для админа инстанса/проекта соответственно.
- D7. Видимость прогонов задачи: админ проекта/пространства/инстанса, автор задачи и её исполнители (и только при доступе к проекту). Прочие — 404. Ревьюер нужен на T1 (права).
- D8. Остановка: прогон `running` → `cancelled` (результат не применяется: `apply` уже проверяет `state = 'running'`); `waiting_human` → `cancelled`. `done`/`failed`/`cancelled` — нельзя.

## 3. Интерфейс (REST `api/ai`, версия 1)
Все — сессия, не токен (`core.auth(req).tokenId` → 403). Строка прогона `AiRunView`: `{id, taskId, projectId, kind, actionId, actionName|null, state, chainDepth, restartOf|null, inputTokens, outputTokens, cost|null, createdAt, updatedAt}`; лог — только в деталях `log: string`.
- `GET /api/ai/tasks/:taskId/runs` → `{runs: AiRunView[]}` (D7), новые первыми, до 50, без лога. Остановить/Перезапустить доступны всем, кто видит прогоны.
- `GET /api/ai/runs/:id` → `{run: AiRunView & {log}}` (D7).
- `POST /api/ai/runs/:id/stop` → 204 (D8); `POST /api/ai/runs/:id/restart` → `{runId}` (D4, `409 conflict` при лимите перезапусков или если выключено).
- `GET /api/ai/monitor` (админ инстанса): query `state?`, `projectId?`, `limit≤200`, `cursor?`(createdAt) → `{runs: (AiRunView & {taskKey, taskTitle, projectName})[], next, load: {running, waiting, queuedToday?…}, today: {tokens, cost}, enabled, limits: {dailyTokens|null, dailyCost|null}}`.
- `PUT /api/ai/settings` (админ инстанса) `{enabled: boolean}` → `{enabled}`; `GET /api/ai/settings` → `{enabled}`.
- `GET|PUT /api/ai/limits?projectId=` (админ проекта): `{dailyTokens|null, dailyCost|null, effective: {dailyTokens|null, dailyCost|null}, usedToday: {tokens, cost}}`.
Суточный лимит проверяется в `handle()` перед вызовом LLM (по сумме токенов/стоимости `ai_runs` проекта за сутки UTC `created_at >= date_trunc('day', now())`); превышение — как `overBudget`: прогон `failed` с понятным логом, без LLM.

## 4. Задачи и волны
- Волна 1: **AI6-1** API: миграция 0053, лимиты, выключатель, остановка/перезапуск, эндпоинты видимости (dp-engineer + dp-reviewer на права).
- Волна 2: **AI6-2** web: вкладка «ИИ» в задаче (`taskPanels`), «Задачи ИИ» (настройки инстанса, админ), выключатель и лимиты; **AI6-3** демо-сид `apps/api/src/db/seed-demo.ts` (прогоны разных состояний, настройки, лимиты) — параллельно, после слияния AI6-1.
- Последняя волна: полный `pnpm test` + `pnpm -s lint` (флейк saved.test.ts — отдельно), `deliver ai6 --into mr/PLNRAPP-171`, уборка, `ai6 done`.

## 5. Стоп-условия
Миграция 0052/0053 занята иначе; конфликт с `ai_runs` из !161; нужен REST v1/MCP — гейт.
