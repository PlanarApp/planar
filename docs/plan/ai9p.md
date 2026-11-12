---
type: plan
status: closed
module: ai9p
updated: 2026-11-12
summary: ИИ-9 (PLNRAPP-174) — harness-пакеты «Продажи», «Найм», «Поддержка» (llm-действия), тесты, демо-сид
related: ["docs/plan/ai9.md", "docs/plan/ai10.md"]
---

# Модуль ai9p — пакеты вне разработки

## 1. Цель
PLNRAPP-174: три harness-пакета в каталоге `modules/ai/harnesses/{sales,hiring,support}/` (`harness.yml` + `actions/*.md`, все `runtime: llm`, во всех правилах фильтр `assignee: [ai]`). Источники: задача PLNRAPP-174; `/root/planar-ai9p/build/ai-plan.md` («### 7. Пакеты вне разработки», стр. 227–299; §6 формат). Образец — пакет `dev`. Движок не меняем (ревью не нужно).

## 2. Решения (2026-11-12, coordinator, пользователь спит)
- Ключи пакетов: `sales` «Продажи», `hiring` «Найм», `support` «Поддержка»; названия — `CATALOG_TITLES` в `modules/ai/api/packs.ts`.
- Формат результата прогона (`resultSchema` в `modules/ai/api/run.ts`): `verdict`, `comment`, `questions`, `descriptionAppend`, `newTasks`, `moveTo`, `labels`, `fields`, `snoozeUntil`, `escalate`, `docs[{parent,title,markdown}]`, `emails[{to,subject,body}]`. Промпты используют только эти поля; статусы/метки/поля называют по имени (как в пакете).
- Статус «Уточнение» (`clarify`, category todo) — `settings.questionStatus` у всех пакетов.
- Триггеры — только из `modules/automations/shared/index.ts`: `task.status_changed`, `task.stale`, `task.unassigned`, `task.waiting_human`, `task.start_reached`, `comment.added {byHuman}`, `schedule {cron}`. Правила, которые добавляют метку/пингуют: цепочка действий `add_label` (`labelId` — ключ метки) + `ai_run`.
- Пробелы движка (проверено по коду), в движок НЕ лезем, в «не сделано»:
  1. `schedule` запускает действие **по каждой открытой задаче**, а не один batch по проекту, и `docs[]` с тем же `parent`+`title` **заменяет** страницу. Поэтому «сводка» — документ **на задачу** (title содержит название задачи) под корнем «Сводки воронок» / отчёт по кандидату; общая сводка воронки одним документом — вне объёма (нужен batch-прогон).
  2. В результате прогона нет создания формы (`forms`): «Анкета кандидату» формирует вопросы по пробелам резюме письмом (`emails[]`); ссылку на форму в режиме «ответ к существующей задаче» (ИИ-8) человек создаёт сам, промпт вставляет её, если она есть в описании/комментариях.
  3. Эскалация в dev-проект (Поддержка) — создаётся подзадача `newTasks` + `escalate`; перенос в другой проект движок из прогона не умеет.
- Найм: в промптах явный запрет оценивать по защищённым признакам (пол, возраст, раса, национальность, религия, инвалидность, семейное положение, беременность и т. п.), оценка только по требованиям вакансии (описание родительской задачи) и подтверждённым навыкам; предупреждение, что персональные данные уходят провайдеру LLM. Тест проверяет наличие запрета в каждом промпте Найма.
- Миграции не нужны (если понадобится — 0058).

## 3. Задачи
- **AIP-1** (волна 1, dp-engineer). Пакет «Продажи». Статусы: Лид, Квалификация, Уточнение, КП, Переговоры, Отложено, Выиграна, Проиграна; метки: горячий, нет ответа, +1 по смыслу; поля: компания (text), контакт (text), email (text), сумма (money или number), источник (text), следующий шаг (text). Действия: `qualify` (BANT), `proposal` (КП и письма — `emails[]` пачкой), `next_step` (после `comment.added byHuman`, `escalate` при скидке выше порога/конфликте/срыве сроков), `lost` (причина + `snoozeUntil` +3 мес., moveTo «Отложено»), `followup` (черновик напоминания), `digest` (сводка воронки → `docs[]` под «Сводки воронок»). Правила: status_changed → Лид→qualify, КП→proposal, Проиграна→lost; comment.added byHuman → next_step; stale 5д в КП/Переговоры → метка «нет ответа» + followup; `start_reached` (status Отложено) → set_status Лид; schedule `0 9 * * 1` → digest. Тест `apps/api/test/ai/pack-sales.test.ts`.
- **AIP-2** (волна 1, dp-engineer). Пакет «Найм» (вакансия = родительская задача, её описание — в контексте). Статусы: Отклик, Скрининг, Уточнение, Интервью, Тестовое, Оффер, Нанят, Отказ. Действия: `screening`, `questionnaire` (письмо с вопросами по пробелам), `interview_questions` (в комментарий), `interview_summary` (по комментариям интервьюеров, `comment.added byHuman` в статусе Интервью), `offer` / `rejection` (письмо `emails[]`), `report` (отчёт по кандидату/вакансии, `docs[]`). Правила: статусы → действия; stale 3д → ping рекрутеру (comment); schedule `0 17 * * 5` → report. Запрет по защищённым признакам. Тест `pack-hiring.test.ts` (включая проверку запрета).
- **AIP-3** (волна 1, dp-engineer). Пакет «Поддержка». Статусы: Новое, Разбор, Уточнение, В работе, Решено, Закрыто. Действия: `triage` (категория, срочность, поиск по вики и закрытым обращениям в контексте), `draft_reply` (письмо `emails[]`), `escalate_dev` (подзадача + `escalate`), `close` (закрытие с комментарием), `to_wiki` («В вики»: на «Решено», ценные решения → `docs[]` под «Вики поддержки», одноразовые пропускает). Правила: Новое→triage, Решено→to_wiki; `task.unassigned 2ч` → escalate_dev; `task.waiting_human 3д` → close (автозакрытие с комментарием). Тест `pack-support.test.ts`.
- **AIP-4** (волна 1, dp-engineer). `CATALOG_TITLES` (+ sales/hiring/support) в `modules/ai/api/packs.ts`; поправить ожидание каталога в `apps/api/test/ai/packs.test.ts` (оно перечисляет пакеты каталога — должно допускать четыре пакета, `actions` считать из файлов).
- **AIP-5** (волна 2). Общий тест `apps/api/test/ai/catalog-packs.test.ts`: каждый из sales/hiring/support — zod/parse, `computeDiff` на пустом проекте, apply через API (по образцу `packs.test.ts`), правила включены; демо-сид `apps/api/src/db/seed-demo.ts` (проект «Продажи» с пакетом, по образцу пакета dev) + `apps/api/test/seed-demo.test.ts`.

## 4. Волны
1. AIP-1..AIP-4 параллельно (каталоги не пересекаются), приёмка, merge `--into feature/ai9p`. `ai9p: wave 1 done`.
2. AIP-5; полный `pnpm test` + `pnpm -s lint`; перед deliver `git fetch origin main` (ушёл вперёд — fast-forward `mr/PLNRAPP-174` и `sync`); `deliver ai9p --into mr/PLNRAPP-174`; `ai9p done`.

## 5. Условия остановки
Нужна правка движка (`run.ts`, automations) — не делать, в «не сделано»; конфликт с MR !166 в `modules/ai/api/index.ts`.

## Решения пользователя
- **План ai9p составлен: 4 задачи в волне 1, AIP-5 в волне 2** (2026-11-12) — пользователь спит, разрешил решать без вопросов
