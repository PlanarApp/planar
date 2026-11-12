---
type: plan
status: closed
module: aifix
updated: 2026-11-12
summary: PLNRAPP-187 — исправление всех 27 находок ревью модуля ИИ, 4 параллельные задачи + ревью безопасности
related: ["docs/plan/ai10.md", "docs/contracts/ai10.md"]
---

# Модуль aifix — исправления по ревью ИИ

## 1. Цель
Исправить все 27 находок ревью (`/root/planar-aifix/build/review.md`, пункты нумерованы там; build/ не в git). Каждый фикс — с тестом, где в ревью указан «Тест». Хост: docker не запускать, runner — только на моках; стенды `./dev.sh stack`, после — down.

## 2. Решения (2026-11-12, coordinator; пользователь: «чиним всё»)
- Миграция одна — `0058` (assignee_id в ai_email_batches п.3 + индексы ai_runs п.21), владелец AIX-2.
- `run.ts` трогают AIX-2 и AIX-4 в разных функциях: AIX-2 — чат/confirmChat/humanOf-фильтр/zod email/тип AiRunKind; AIX-4 — blocked(), handle (restart). Сливаем AIX-2, затем AIX-4 (конфликты решаем при слиянии).
- Расход doc-chat (п.4) пишет AIX-3 строкой `ai_runs` существующего kind `chat` (project_id задан, без новых значений CHECK; миграцию не делать).
- Ревью: один dp-reviewer после слияния на п.2, 3, 4, 8, 9.

## 3. Задачи (волна 1, параллельно)
- **AIX-1** runner/агент: п.7, 8, 10, 23 + размер tmpfs /work из env runner'а с потолком.
- **AIX-2** письма/чат/инструменты: п.2, 3, 6, 9, 18, 21, 24, 27 (CHAT_BULK_LIMIT, ToolDanger, AiRunKind) + миграция 0058.
- **AIX-3** harness/пакеты/doc-chat: п.1, 4, 13, 14, 15, 16, 17, 25, 26, 27 (spec правил).
- **AIX-4** мониторинг/лимиты: п.5, 11, 12, 19, 20, 22, 27 (restartDepth).

## 4. Финал
Полный `pnpm test` + `pnpm -s lint`; `git fetch origin main`; `deliver aifix --into mr/PLNRAPP-187`; отчёт о неисправленном.
