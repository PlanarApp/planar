---
type: reference
status: active
module: collab
updated: 2026-10-23
summary: Контракты collab — документы (DC-schema, DC-mutators), чат (CH-*), правки ядра для чата (X-core, после шлюза и WK-0)
related: ["docs/plan/collab.md", "docs/contracts/core.md", "docs/contracts/core-mutators.md", "docs/contracts/web.md"]
---

# Контракты модуля collab

Владелец — координатор collab. Формат сущностей и мутаторов — как в `docs/contracts/core.md` (C-schema) и `core-mutators.md`; правила C-schema «Общие правила», «Типы», «Видимость и права» действуют. Контрактный тест — `apps/api/test/modules/collab.contract.test.ts`: сверяет разделы `#### <сущность>` и таблицы мутаторов этого файла с `shared.entities` и `shared.mutators` модулей (имена полей, nullability, meta, имена и необязательность args).

## DC-schema v1

Модуль `docs` (`modules/docs`, пакет `@planar/module-docs`), таблицы `docs_<snake>`. FK между сущностями модуля — без каскада; на `tasks` FK нет (ядро удаляет задачи, не зная о модуле): связь с удалённой задачей UI не показывает.

#### docsPages
scope: space · write: member · bootstrap: yes · indexes: spaceId, parentId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `parentId` | uuid? | страница того же пространства; null — корень |
| `rank` | rank | порядок среди соседей (один `parentId`) |
| `title` | text | 0–200 символов; пусто — UI пишет «Без названия» |
| `icon` | text? | эмодзи, 1–16 символов |
| `body` | doc | ProseMirror/TipTap JSON; ≤ 512 КБ в JSON |
| `text` | text | текст всех text-узлов `body` через пробел, обрезан до 100 000 символов; считает мутатор |
| `files` | json | `string[]` — sha256 (hex 64) из узлов `{type:'image', attrs:{src:'/files/<sha256>…'}}` `body`, без повторов, по порядку; считает мутатор |
| `createdBy` | uuid | |
| `updatedBy` | uuid | последний, кто менял `title`/`icon`/`body` |
| `archivedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Инварианты: `parentId` не образует цикл; у неархивной страницы родитель неархивный.

#### docsTaskLinks
scope: space · write: member · bootstrap: yes · indexes: pageId, taskId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (pageId, taskId) |
| `spaceId` | uuid | |
| `pageId` | uuid | |
| `taskId` | uuid | задача того же пространства; без FK |
| `createdBy` | uuid | |
| `createdAt` | ts | |

#### docsLocks
scope: space · write: member · bootstrap: yes · indexes: —

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | = id страницы (одна блокировка на страницу) |
| `spaceId` | uuid | |
| `userId` | uuid | кто редактирует |
| `expiresAt` | ts | `ctx.now` + 120 с; клиент продлевает раз в 60 с, пока открыт редактор |

Мягкая блокировка: только индикатор «редактирует X» и режим чтения у остальных в UI; `docs.page.update` её не проверяет. Истёкшая (`expiresAt ≤ ctx.now`) считается отсутствующей. Шорткат: без совместного редактирования; понадобится — Yjs + Hocuspocus.

## DC-mutators v1

Экспорт — `shared.mutators` из `modules/docs/shared/index.ts`; `args` — `z.object`. Все id и `rank` — в args. Чужое пространство или нет строки — `not_found`/`forbidden` по общим правилам серверного `Tx`.

| имя | args | правила |
|---|---|---|
| `docs.page.create` | `id, spaceId, rank, parentId?, title?, icon?, body?` | родитель — неархивная страница того же пространства, иначе `invalid_args`; `title` по умолчанию `''`, `body` — `{type:'doc', content:[]}`; `text`, `files` из `body`; `createdBy = updatedBy = ctx.userId` |
| `docs.page.update` | `id, title?, icon?, body?` | архивная → `conflict`; `body` → пересчёт `text`, `files`; `updatedBy = ctx.userId` |
| `docs.page.move` | `id, parentId, rank` | `parentId: uuid \| null` (ключ обязателен); сама страница или её потомок → `invalid_args`; другое пространство → `invalid_args`; страница или новый родитель архивные → `conflict` |
| `docs.page.archive` | `id` | `archivedAt = ctx.now` у страницы и всех её неархивных потомков; уже архивная — ничего |
| `docs.page.restore` | `id` | снимает `archivedAt` у страницы и потомков с тем же `archivedAt`; родитель архивный → `parentId = null` |
| `docs.link.add` | `id, pageId, taskId` | задача (строка `tasks`) и страница одного пространства, иначе `invalid_args`; пара уже связана — ничего |
| `docs.link.remove` | `pageId, taskId` | нет связи — ничего |
| `docs.lock` | `pageId` | нет блокировки, истекла или своя → `put {id: pageId, spaceId страницы, userId: ctx.userId, expiresAt: ctx.now + 120 с}`; чужая действующая → `conflict` |
| `docs.unlock` | `pageId` | своя → удалить; иначе ничего |

Удаления страниц нет (только архив) — шорткат до запроса пользователя.

## DC-web v1 (CL-4)
- Маршрут `/m/docs/:pageId` — страница; `/m/docs` — последняя открытая или пусто.
- Дерево страниц — точка боковой панели из WK-0 (C-modules v3, `docs/contracts/work.md`), по пространствам; перетаскивание = `docs.page.move`.
- Панель задачи `taskPanels`: `{id: 'pages'}` — связанные страницы, связать/отвязать.
- Поиск Cmd+K — по `docsPages.title` и `text` локальной реплики (точка поиска — X-core, после шлюза).
- Изображения — `POST /files`, узел `image` с `src: '/files/<sha256>'`; чтение файла другими участниками — X-core `canReadFile`.

## CH — чат (проект, ждёт шлюза C-sync)

Модуль `chat` (`modules/chat`). Каналы пространства (`spaceId` задан) видны всем участникам пространства. Личные диалоги — `spaceId = null`, видны только участникам диалога (`chatMembers`), 2–8 человек. Видимость диалогов требует X-core «C-sync v2».

Сущности (точные таблицы — после шлюза):
- `chatChannels` — `space|members` через `id`: `id, spaceId?, kind enum(channel,dm), name text? (канал 1–80, у диалога null), topic text?, createdBy, lastSeq int (номер последнего сообщения верхнего уровня), lastMessageAt ts?, archivedAt ts?, createdAt, updatedAt`.
- `chatMembers` — только диалоги, `space|members` через `channelId`: `id, channelId, userId, createdAt`; уникально (channelId, userId).
- `chatMessages` — `space|members` через `channelId`, **bootstrap: no** (история — REST, новое — pull): `id, spaceId?, channelId, parentId uuid? (корень треда, один уровень), seq int? (у верхнего уровня = lastSeq+1 канала, у ответов null), authorId, body doc, mentions uuid[], attachments json ({fileSha256,name,mime,size,width?,height?}[]), replyCount int, lastReplyAt ts?, editedAt ts?, deletedAt ts? (мягкое удаление: body пуст, mentions и attachments пусты), createdAt, updatedAt`; indexes `channelId, parentId`.
- `chatReactions` — `space|members` через `channelId`, bootstrap: no: `id, spaceId?, channelId, messageId, userId, emoji, createdAt`; уникально (messageId, userId, emoji).
- `chatReads` — `scope: user`, write self: `id, userId, channelId, lastReadSeq int, muted bool, updatedAt`; уникально (userId, channelId). Непрочитано = `chatChannels.lastSeq − lastReadSeq`.

Мутаторы: `chat.channel.create|update`, `chat.dm.create {id, members:{id,userId}[2..8] вкл. себя}`, `chat.dm.addMember`, `chat.dm.leave`, `chat.message.send {id, channelId, parentId?, body, attachments?, readId}`, `chat.message.update`, `chat.message.delete`, `chat.reaction.toggle`, `chat.read`, `chat.mute`.

REST (`/api/chat/`, видимость как у канала, иначе `404`):
- `GET /api/chat/channels/:id/messages?before=<seq>&limit=<1..100, 50>` → `{messages, reactions}` — верхний уровень с `seq < before` (без `before` — последние), по возрастанию `seq`;
- `GET /api/chat/messages/:id/thread` → `{root, replies, reactions}`, ответы по `createdAt`.

Уведомления — хук `afterMutation` из WK-0 (`docs/contracts/work.md` §C-modules v3): строки `notifications` через `api.sys`, push — `api.enqueue('push.notification', {notificationId})` на каждое (очередь ядра, `apps/api/src/push/push.ts`): `chat_mention` (новые упомянутые; видят канал), `chat_dm` (каждому участнику диалога, кроме автора, упомянутых и `muted`), `chat_reply` (автору корня и прежним ответившим, кроме автора и упомянутых; в диалогах — только `chat_dm`). `url` — `/m/chat/c/<channelId>/<messageId>`, для ответа — `/m/chat/c/<channelId>/t/<rootId>`.

## X-core — правки ядра от collab (проект, шлюз)

Делает collab отдельной задачей **после** вливания WK-0 (feature/work): хук `afterMutation`, pg-boss в транзакции, точки web nav/topbar — из WK-0, здесь не дублируются.

1. **C-sync v2 — видимость `space|members`.** `EntityMeta` += `members?: {entity, key, container, via}` (для chat: `{entity:'chatMembers', key:'channelId', container:'chatChannels', via:'id'|'channelId'}`).
   - `row.spaceId` задан → как `space`. Иначе получатели — `userId` строк `members.entity` с `key = row[via]` (состояние после записи, в той же транзакции): по строке `changes` на каждого, `user_id = получатель`, `space_id = null`. Pull и WS не меняются.
   - Новая строка `members.entity` (участник добавлен) → новому участнику дополнительно `put` контейнера и всех `bootstrap: yes`-строк этого контейнера; удалена → ему `del` тех же строк. `_reset` не пишется. История сообщений (`bootstrap: no`) — через REST.
   - Bootstrap: `spaceId ∈ мои пространства` или (`spaceId` null и `row[via]` ∈ мои `key` из `members.entity`).
   - Запись (серверный `Tx`): `spaceId` задан → роль ≥ `write` сущности; иначе `ctx.userId` — участник `row[via]` или `createdBy` контейнера = `ctx.userId` (новый контейнер — `row.createdBy = ctx.userId`). Проверка — по старой и новой строке.
   - e2e на утечку: третий не получает строк диалога ни в bootstrap, ни в pull, ни данных по WS.
2. **WS «печатает…».** Клиент → `{t:'typing', entity, id}`; сервер — если отправитель видит строку — рассылает `{t:'typing', entity, id, userId}` подключённым, кто её видит, кроме отправителя; не чаще раза в 3 с на (отправитель, id). Клиент показывает 5 с. C-client: `sendTyping(entity, id)`, `onTyping(cb) => unsubscribe`.
3. **Уведомления.** `notifications`: `spaceId uuid?`, `taskId uuid?`, `kind` += `chat_mention, chat_dm, chat_reply`, новые `url text?` (путь в приложении), `body text?` (≤ 140 символов: «Имя: текст»). Push (C-http «Web Push»): нет `taskId` → `url`, `body` из уведомления; правила `url` прежние. Inbox web показывает такие уведомления по `body` и ведёт на `url`.
4. **Файлы.** `BackendModuleManifest.canReadFile?(q, userId, sha256): Promise<boolean>` — `GET /files/:sha256` разрешён, если `true` вернул любой включённый модуль. chat — файл во `attachments` сообщения видимого пользователю канала **и** есть `file_uploads(sha256, authorId сообщения)`; docs — файл в `docsPages.files` страницы пространства пользователя **и** есть `file_uploads(sha256, u)` для участника `u` этого пространства. Запись не проверяется (хук `afterMutation` не может отклонить мутацию): чужой sha256 без своей загрузки файла не открывает.
5. **Поиск Cmd+K.** web: точка расширения `search` — `{id, label, search(q: string, limit: number): Promise<{id, title, subtitle?, icon?, to: RouteLocationRaw}[]>}`; палитра показывает группы модулей под задачами.
