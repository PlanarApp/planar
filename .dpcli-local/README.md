# Project layer for dpcli

Committed with the project; `dpcli init` renders it on top of the dpcli distribution (`.dpcli`), so updates of dpcli never overwrite it.

- `agents/<name>.append.md` — appended to the dpcli agent `<name>` (preferred: the agent keeps receiving updates).
- `agents/<name>.md` — your own agent, or a full replacement of a dpcli agent with that name.
- `skills/<name>/` — project skills; a skill with a dpcli skill's name replaces it.
- `workflow.md` — project rules, appended to the process description as "Project rules".
- `claude-md.md` — lines appended to the dpcli block in `CLAUDE.md`.
- `feedback.jsonl` — friction ledger (`dpcli feedback`).

After editing: `.dpcli/dpcli init`, then commit this directory and `.claude/`.
