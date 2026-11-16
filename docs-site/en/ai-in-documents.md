---
title: AI in documents
description: Calling the AI in page comments, what it does and its limits
---

# AI in documents

Needs the `ai` module turned on in the project the page belongs to and an AI connection (Settings → AI). Pages outside a project are not served.

## 1. How to call the AI

In a page comment:

- write `@ai` in the text;
- assign the comment to the bot «ИИ» (an assignment);
- reply in a thread under a comment of the AI.

Only people start the AI; comments of the AI itself and of automations do not. The AI starts a few seconds after the comment (several quick edits are one run). An indicator of the AI's work shows in the comment while it runs.

## 2. What it does

The AI reads the page, the whole thread, and, on pages of a harness pack, the project's statuses and rules. Then:

- answers in the thread (under its root comment);
- an assigned comment (an assignment) is also marked resolved when the AI is done;
- if it needs an answer, it asks in the thread, mentions the author and re-assigns the comment to them; the answer starts a new run;
- changes the page only on an assignment: precise edits `[{find, replace}]` are applied as a new version in the page's version history, the author is the AI. If the edits do not apply, the AI says so in the reply and the assignment stays open.

## 3. Limits

- A page with mentions of people or pages in its body is not edited (`patch_mentions`): nothing is written.
- A `@ai` mention or a reply never edits the page; edits are made only on an assignment.
- A fragment to replace must occur exactly once in the page text (or all occurrences are replaced on request); otherwise nothing is changed.
- The project's AI limits and pauses apply as for tasks; without a connection the AI answers with an error in the thread.

## 4. Harness pack instructions

The active pack of the project can bind an action to the `comment` event (an assignment) and the `mention` event (`@ai` or a reply). Its model, token limit, readiness criteria and instruction page are added to the built-in instruction. Without an action the built-in one is used.

## 5. REST and MCP

- REST: `GET|POST /api/v1/docs/:pageId/comments`, `POST /api/v1/docs/:pageId/comments/:id/resolve`, `POST /api/v1/docs/:pageId/patch`;
- MCP: `list_doc_comments`, `add_doc_comment`, `resolve_doc_comment`, `patch_doc` (see [MCP](/mcp)).

Permissions are those of the token owner.

## 6. What the AI can do in chat

The personal AI chat works with your permissions: what you may not do, the AI will not do.

- Answers from the Planar documentation (`search_docs_site`).
- Sets up a project: automation rules, AI actions, statuses, labels, fields, harness packs and event bindings, project fields, turning modules on and off. The chat does not change AI, GitLab and mail connections, webhooks or limits.
- Processes tasks in bulk: up to 100 tasks at a time.

Any settings change and any batch run only after your «yes» to the list of changes: one «yes» covers the whole batch. The size of a run is capped by the `AI_CHAT_MAX_STEPS` and `AI_CHAT_MAX_TOKENS` [variables](/configuration).
