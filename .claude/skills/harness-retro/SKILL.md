---
name: harness-retro
description: "Review the planar process (harness) — collect `harness:` frictions and `dp_feedback`, measure token usage per session, propose ≤ 3 improvements to the user and apply the approved ones. Used by the main session on `<m> done`, once per phase, or when the user asks to improve the process or cut costs."
---

# harness-retro — process review

Cheap: one session, no subagents, only the commands below. Don't read project code.

1. **Since when.** `.dpcli/dpcli log harness` — date of the last `retro:`. No module — `.dpcli/dpcli module init harness`, period — from the start.
2. **Frictions.** `.dpcli/dpcli search "harness:"` and `.dpcli/dpcli search "dpcli:"` (old notes) — only entries after the date from step 1, plus `dp_feedback` of reports.
3. **Cost.** `python3 .claude/skills/harness-retro/cost.py --since <YYYY-MM-DD>`: sessions, turns, average and max context, main/subagent share, models. Alarming: main session average context > 200k, a session longer than a phase, Opus on agents outside the models table.
4. **Group.** Recurring (≥ 2 times) or expensive (cost, rework rounds). One-offs — skip.
5. **Propose to the user** as one list, ≤ 3 items: `what hurt (refs: ID/module) → change (file) → gain/cost`. Change nothing without approval.
6. **Apply the approved** in the source: `.dpcli/templates/workflow.md`, `.dpcli/templates/claude-md.md`, `.dpcli/agents/*.md`, `.dpcli/skills/**`; a change to dpcli itself is a task in a module, not here. Then `.dpcli/dpcli init`, `git diff --stat`, commit only these files and `.claude/`, `CLAUDE.md`.
7. **Record.** Each decision — `.dpcli/dpcli decide harness "<change>" --by user --why "<friction>"`; summary — `.dpcli/dpcli event harness note --note "retro: <date>; accepted N, rejected M"`.
