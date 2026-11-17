---
type: contract
status: closed
module: aistat
updated: 2026-11-17
summary: Контракт aistat — состояние queued в ai_runs, finished_at, агрегат затрат, форма ответов статуса/активности; версия 1
related: ["docs/plan/aistat.md", "docs/contracts/ai10.md"]
contracts: [{"id": "aistat", "version": 1}]
---

# Контракт aistat — v1

Владелец — координатор aistat; потребители — веб (`apps/web/src/modules/activity.ts`, `task/`, `views/`), `modules/ai/api`. Изменение — версия +1 и `task note` потребителям.

## 1. Состояния `ai_runs.state`
`AI_RUN_STATES = queued | running | waiting_human | done | failed | cancelled` (`modules/ai/shared/index.ts`). Миграция: CHECK/enum состояния (если есть) расширяется `queued`.
- Постановка в очередь (`run.ts`, `api.enqueue(AI_QUEUE, d, …)` для kind action/comment/mention/checklist, ~1417): перед enqueue отменяется прежняя `queued` строка той же пары (`task_id, kind, coalesce(item_id, action_id)`) (`cancelled`), вставляется строка `state='queued'` с новым `id`; этот `id` кладётся в данные задания как `runId`. Итого — одна `queued` на ключ (`keyOf`).
- Обработчик (`run.ts` ~507-523): если есть строка `id = d.runId` в `queued` — `update … set state='running', started_at = now(), updated_at = now() where id = … and state='queued'`, иначе (старые задания без строки, `restart`, `agentsFull`-повтор с тем же `d`) — как раньше `insert … 'running'`. Строка, отменённая более новой постановкой, — задание пропускается (`cancelled` не оживает).
- Когда pg-boss-задание взято, а строка ещё `queued` — это «Ждёт» (так же, как при `startAfter`/`agentsFull`): отдельного состояния нет.
- `queued` не считается «активным прогоном» для лимитов (`agentsFull`, `blocked`, счётчики `running` в controller ~472) и не мешает «новее выигрывает» (`state in ('running','waiting_human')` остаётся как есть); `cancel` (controller ~384) отменяет и `queued`.
- Не-задачные прогоны (chat, retro, doc_*) `queued` не создают.

## 2. Статус задачи для клиента
- `AiActivity.state` (`GET api/ai/activity/tasks/:taskId`) = `queued | running | waiting_human | failed | done`; `done` — последний прогон задачи завершён успешно и новее любого `failed`-восстановленного состояния (последний завершённый прогон), без окна `ACTIVITY_GRACE_MS`.
- `AiTaskStatus`/`AI_TASK_STATUSES` (`GET api/ai/status/projects/:projectId`) = `queued | running | waiting_human | failed | done | none`; приоритет при нескольких прогонах: `running` > `waiting_human` > `queued` > последний завершённый (`failed` | `done`). Задачи без прогонов (`none`) не отдаются. Поля — как сегодня (`taskId, status, runId, startedAt`) + `cost` из §3, когда AST-3 слит.
- Видно только при `'ai' = any(p.modules)` (API) / `enabledForProject('ai', projectId)` (веб).

## 3. Затраты (AST-3)
- `ai_runs.finished_at timestamptz null` — ставится при переходе в `done | failed | cancelled` везде, где state меняется на эти значения (apply, жнец `agent.ts`, cancel, «новее выигрывает»); для старых строк — миграцией `finished_at = updated_at` где state final.
- Агрегат по задаче: `{ runs: int, seconds: number, inputTokens: int, outputTokens: int, cost: number|null }`; `seconds = Σ(finished_at − started_at)` по завершённым прогонам (только с `finished_at`), `cost = Σ cost` (null, если ни у одного нет цены). Поле `usage` в ответе активности задачи и в строке статуса проекта.

## 4. Миграции
Номер — следующий после `0069`; AST-1 и AST-3 миграции не пересекают (AST-3 стартует после слияния AST-1 в `feature/aistat`, берёт следующий номер).
