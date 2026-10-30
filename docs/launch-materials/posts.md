---
type: guide
status: active
module: launch
updated: 2026-10-30
summary: Тексты постов запуска: Show HN, r/selfhosted, r/opensource, r/projectmanagement, Product Hunt, vc.ru, Telegram
related: ["docs/roadmap.md", "README.md", "docs/plan/launch.md"]
---

# Посты запуска

Ничего не опубликовано. Ссылки на статью подставить после публикации. Домены planarhq.* запланированы, не зарегистрированы; в постах только репозиторий.

## Show HN

Заголовок (до 80 знаков): `Show HN: Planar – self-hosted task tracker with local-first sync`

Текст:

> Planar is a task tracker for teams. The browser keeps a local replica of your data in IndexedDB, mutations are applied optimistically and queued while offline, and a server change log plus a WebSocket poke keeps clients in sync. Conflicts are last-write-wins per field, the server is the source of truth.
>
> It is self-hosted: docker compose with PostgreSQL 18, a NestJS API and Caddy. It has a REST API and a built-in MCP server (Streamable HTTP, personal tokens with read/write scope), and features are modules under modules/*. Apache 2.0, version 0.9.0 (public beta).
>
> Known limitation: issuing ACME certificates for a public domain has not been tested yet. Guides are currently in Russian.
>
> Repo: https://gitlab.com/planarhq/planar (mirror: https://github.com/PlanarApp/planar). Write-up of the sync design: <ссылка на article-en>.
>
> Feedback on the sync model is especially welcome.

## r/selfhosted

Заголовок: `Planar: self-hosted task tracker (docker compose, PostgreSQL 18, Caddy), offline-capable PWA`

> I built a task tracker you run yourself. Stack: `docker compose` with PostgreSQL 18 (pgvector), the API and Caddy (automatic TLS). One instance is one workspace; the first visit creates the owner. Backup, restore and upgrade scripts are in `ops/`. No Redis: queues and pub/sub are in PostgreSQL.
>
> Beta (0.9.0). Not tested yet: ACME certificates for a public domain. Deploy guide (Russian for now): docs/guides/deploy.md.
>
> https://gitlab.com/planarhq/planar | mirror https://github.com/PlanarApp/planar

## r/opensource

Заголовок: `Planar, an Apache-2.0 task tracker with local-first sync, 0.9.0 beta`

> Planar is released under Apache 2.0 (the name and logo are not covered by the license, see TRADEMARK.md). Features are modules in `modules/*`, plugins can be embedded as sandboxed pages, there is a REST API and an MCP server. Contributions: CONTRIBUTING.md in the repo. The guides are in Russian for now, translation help is welcome.
>
> https://gitlab.com/planarhq/planar | mirror https://github.com/PlanarApp/planar

## r/projectmanagement

Заголовок: `Open-source task tracker with an instant UI and offline mode — looking for feedback from PMs`

> Planar covers tasks, subtasks, checklists, labels, assignees, comments, attachments, notifications and Web Push. Modules add sprints, time tracking, forms, automations, webhooks, dashboards and docs. The interface works from a local copy of the data, so it responds without waiting for the network and keeps working offline. It is a beta; I would like to know what is missing for your workflow.
>
> https://github.com/PlanarApp/planar

## Product Hunt

Название: Planar
Tagline (до 60 знаков): `Task tracker with a local replica, self-hosted`
Описание:

> Open-source task tracker for teams. Instant UI from a local replica in the browser, offline mode, installable PWA, REST API and a built-in MCP server for AI agents. Self-host with Docker Compose. Apache 2.0, public beta 0.9.0.

Первый комментарий:

> Hi, I'm the maker. Planar keeps your data in IndexedDB and syncs through a change log. Features are modules, so you can enable only what you need. Beta: we would love bug reports and ideas. Repo: https://github.com/PlanarApp/planar

Сайт на Product Hunt: домен planarhq.com запланирован, пока не зарегистрирован — до регистрации указывать репозиторий.

## vc.ru

Заголовок: `Мы открыли код трекера задач с офлайн-режимом и MCP для ИИ-агентов`

> Planar — трекер задач для команд. Данные лежат в браузере в локальной реплике, поэтому интерфейс отвечает без ожидания сети и работает офлайн. Свой сервер ставится через Docker Compose (PostgreSQL 18, API, Caddy). Есть REST API и встроенный MCP-сервер, чтобы подключать ИИ-агентов с личным токеном (права read или write). Функции подключаются модулями.
>
> Лицензия Apache 2.0, версия 0.9.0, публичная бета. Руководства пока на русском. Как устроена синхронизация — в статье: <ссылка на Хабр>.
>
> Репозиторий: https://gitlab.com/planarhq/planar (зеркало: https://github.com/PlanarApp/planar)

## Telegram

> Открыли код Planar — трекера задач с локальной репликой данных в браузере: быстрый интерфейс, офлайн, PWA, REST API и MCP для ИИ-агентов. Ставится у себя через Docker Compose. Apache 2.0, бета 0.9.0.
> Репозиторий: https://gitlab.com/planarhq/planar
> Как устроена синхронизация: <ссылка на Хабр>
> Нужны отзывы и баг-репорты.
