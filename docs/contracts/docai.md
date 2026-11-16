---
type: contract
status: closed
module: docai
updated: 2026-11-15
summary: Контракт docai — ai_runs.page_id, прогон ИИ по странице, патч страницы, REST/MCP комментариев страницы, runtime agent для страниц; v2
related: ["docs/plan/docai.md"]
contracts: [{"id": "docai-run", "version": 2}, {"id": "docai-patch", "version": 1}]
---

# Контракт docai — v2

Владелец — координатор docai. Потребители: DOC-1 (конвейер), DOC-2 (патч, REST/MCP), DOC-5 (события пакета), DOC-6 (runtime agent), DOC-7 (бот по login), web (DocComments, мастер), docs-site. v2 — по коду: уточнены триггеры, результат, события пакета, индикатор; добавлен раздел 4.

## 1. docai-run — прогон ИИ по странице (v2)
- `ai_runs.page_id uuid null` (миграция, индекс `(page_id, item_id, state)`); `task_id` и `page_id` не заданы одновременно; прогон чата — оба null. `item_id` — комментарий страницы (`docs_comments.id`).
- `AiRunData` получает варианты `{kind: 'doc_comment' | 'doc_mention', pageId, itemId, restartOf?, runId?}`; ключ debounce — `${pageId}:${itemId}`. `ai_runs.kind` — `doc_comment` (комментарий назначен на ИИ или ответ на комментарий ИИ) / `doc_mention` (`@ai`).
- Бот ИИ — пользователь с `login = 'ai'` и `bot` (`AI_BOT_LOGIN`); для страниц — тот же бот, что для задач.
- Триггеры (`docComments` в `afterMutation`, `modules/ai/api/index.ts`) — по записям `docsComments` (create/update/assign), только от человека: мутации системы/ИИ (`ctx.system`, `ctx.origin`) и авторы-боты запуск не дают. `assigneeId` стал ботом и комментарий не решён → `doc_comment`; бот впервые в `mentions` (`@ai`) → `doc_mention`; новый комментарий с `parentId` на комментарий бота → `doc_mention`. Задание в очередь: `singletonKey = ${pageId}:${itemId}`, `upsert`, `startAfter: 5` с.
- Контекст llm-прогона: `{page: {id, title, markdown}, thread: [{id, author, text, createdAt}], assignment: {kind, id, text}, project: {statuses, rules}|null}`; `thread` — вся ветка от корня (ответ идёт под корнем), `project` — только для страниц активного harness-пакета (корень пакета или его прямой потомок), иначе null.
- Инструкции пакета: действие, привязанное к событию `comment` (для `doc_comment`) / `mention` (для `doc_mention`) в `ai_harness_packs.events` (`eventAction` в `run.ts`), даёт модель, лимит токенов, `checks` (done — только если все выполнены) и текст инструкции (страница действия) поверх встроенного `DOC_SYSTEM`; без действия — только `DOC_SYSTEM`. У действия нет страницы инструкции → прогон `failed` с комментарием.
- Результат (схема `AiResult` + `pagePatch: {edits}|null`): ответ — `docs.comment.create` от бота под корнем ветки (`parentId` — корень). `verdict: question` — вопросы списком в комментарии с упоминанием автора поручения; для `doc_comment` поручение переназначается на автора (прогон `done`, ответ человека запускает новый). `verdict: done` и `doc_comment` без `keepOpen` — ещё `docs.comment.resolve`. `fail` → состояние `failed`, комментарий с причиной. Мутации идут одной транзакцией от бота с `origin {aiRunId}`; если прогон уже не `running` (его вытеснил новый) — ничего не применяется.
- `pagePatch` применяется до ответа (`applyPagePatch`, от имени бота) только для `doc_comment` и только пока прогон `running`; ошибка патча не валит прогон: в лог — причина, к ответу добавляется «Изменения не применены: …», поручение остаётся открытым. Для `doc_mention` правки игнорируются, в ответ добавляется пометка.
- Прогон по паре `(page_id, kind, item_id)`: новый отменяет (`cancelled`) прежний `running`/`waiting_human`. Перезапуск (`restartOf`, `runId`) при невозможности (ИИ не настроен, комментарий удалён/решён/не на ИИ) записывает `failed`-прогон с причиной в лог. Бюджет и «blocked» — `blocked(db, projectId)` как у задач; без подключения к ИИ — `failed`-ответ в ветку.
- Страница без проекта, без модуля `ai` в проекте, архивная, или нет бота — прогон не создаётся (молча; кроме перезапуска).
- Индикатор: `GET /api/ai/activity/pages/:pageId` → `{activity: AiActivity[]}` — прогоны страницы в состоянии `running` (до 50); только сессия (токен → 403), нужен член пространства, роль в проекте и модуль `ai`; иначе 404.

## 2. docai-patch — патч страницы
Тип `PagePatch = {edits: {find: string, replace: string, all?: boolean}[]}`, 1..50 правок, `find` непустой, ≤ 16 КБ.
- Применение (`applyPagePatch(q, {pageId, edits}, actor)` в `modules/docs/api`): тело страницы → markdown (`docToMarkdown`); правки по порядку; `find` встречается ровно один раз, иначе при `all` — все вхождения; затем `markdownToDoc` → `docs.page.update` от имени актора (история версий, collab `external`).
- Ошибки (`{code}`): `patch_not_found` (find нет), `patch_ambiguous` (больше одного без `all`), `patch_mentions` (в теле страницы есть узлы упоминаний — страница отклоняется целиком, ничего не записано), `patch_empty`, `forbidden` (нет прав на запись), `not_found`. Атомарно: при любой ошибке страница не меняется.
- Результат: `{ok: true, versionId?}`.

## 3. REST ↔ MCP (паритет)
Новые операции REST v1 и одноимённые инструменты MCP (строка в `PARITY`, тест):
- `GET /api/v1/docs/:pageId/comments` → MCP `list_doc_comments {pageId}` — ветки: `{id, parentId, authorId, text(markdown), assigneeId, resolved, createdAt}`.
- `POST /api/v1/docs/:pageId/comments` `{text, parentId?, assigneeId?}` → `add_doc_comment`; `POST …/comments/:id/resolve` → `resolve_doc_comment`.
- `POST /api/v1/docs/:pageId/patch` `{edits}` → `patch_doc {pageId, edits}`; ответ и ошибки — раздел 2.
Права — как у мутаторов `docs.comment.*` / `docs.page.update` (пользователь токена).

## 4. Runtime agent для страниц (v2, задумано — DOC-6)
Для действия пакета с `runtime = agent` и заданным `AI_RUNNER_URL` страничный прогон (`doc_comment` / `doc_mention`) идёт в контейнер, а не в llm-путь `handleDoc`.
- `context.json` контейнера: `{runId, page, thread, assignment, project, action, checks}` — те же `page`/`thread`/`assignment`/`project`, что в разделе 1, плюс действие и его критерии.
- Результат тот же (`AiResult`, `comment`, `pagePatch?`); `pagePatch` применяет сервер (`applyPagePatch`) до публикации ответа — контейнер страницу не пишет.
- llm-прокси для страничного прогона лимитирует только `blocked` (бюджет и паузы), без привязки к задаче.
- Без `AI_RUNNER_URL` или при `runtime = llm` — путь раздела 1.
