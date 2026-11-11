<!-- dpcli:begin -->
## Working with agents (dpcli)

Before multi-step work read **`.claude/dpcli-workflow.md`**. Journal, tasks, branches, docs — only via `.dpcli/dpcli` (`.dpcli/dpcli -h`), one command per Bash call: chained with `&&` / `cd …;` it misses the `Bash(.dpcli/dpcli *)` permission and may be refused.

- Language: replies, reports, journal, plans, docs — Russian; commit messages — Russian.
- Roles: user — decisions; main session — plans, module coordinators, reports on events (gate, `<m> done`) or on request, merges into `main` on approval; `dp-coordinator` — contracts, cards, acceptance, gates; executor — one task in its own copy.
- Messages follow the protocol (.claude/dpcli-workflow.md, "Message protocol"): IDs and commands, no retelling of the journal.
- Deterministic work — `.dpcli/dpcli` commands; the journal `docs/plan/<m>/` is append-only.
- Correctness over "looks nice"; don't invent; don't polish.
- One session — one phase/module: after a merge or a change of topic — `/clear`, state comes from the journal.
- Process frictions — at once, one line `harness: …` (in `dp_feedback` or `event <m> note`); review and process changes — skill `harness-retro`, on its own, the user is told after.
- Docs — entry `docs/INDEX.md`; find with `.dpcli/dpcli docs find`, read by section `.dpcli/dpcli docs section <path> [section]`, not whole.
- Commits — only your own files (`git commit -- <paths>`); no push without the user's command; after a merge `.dpcli/dpcli gc --remove`.
- Agents — `.dpcli/agents/`, process — `.dpcli/templates/workflow.md`; `.claude/` is refreshed by `.dpcli/dpcli init`.
- `main` — только через MR: никаких `deliver`/`merge --into main` и коммитов в `main`; доставка модуля — `deliver <m> --into mr/<m>`, пуш и MR — по команде пользователя.
- Задачи Planar PLNRAPP («бери следующие задачи» = статус «К работе»): «В работе» → план в описание → при возврате комментарии (ответить + готово) → test+lint → push, MR, автомерж после CI → уборка; порядок — `.claude/dpcli-workflow.md`, «Задачи Planar».
- Демо: видимая пользователю новая функция или изменение старой — в той же задаче обновить демо-сид `apps/api/src/db/seed-demo.ts` (только сидом, без демо-кода в приложении); формат JSON модулей проверяет `apps/api/test/seed-demo.test.ts`.
<!-- dpcli:end -->
