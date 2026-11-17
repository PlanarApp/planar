import { z } from 'zod';
import { resultSchema, type AiResult } from '../../run.js';

// the keys come from the zod schema of a run result; the texts are typed against it (a renamed key breaks the build)
const FIELD_DOC: Record<keyof AiResult, string> = {
  verdict: 'done | question | fail',
  comment: 'the outcome for people (markdown); the reason on fail',
  questions: 'one string per question; with verdict question',
  descriptionAppend: 'plan/outcome; replaces the "План (ИИ)" block of the task description',
  newTasks: 'subtasks {title, description, status (name; null = first todo status)}',
  moveTo: 'status name',
  labels: 'label names; "Name" adds, "-Name" removes',
  fields: 'field values {name, value}',
  subtasks:
    'changes of existing subtasks of the same project {key, title, moveTo, labels, fields} — all required, no change is "" or [], not null; unknown key goes to the run log',
  snoozeUntil: 'YYYY-MM-DD',
  escalate: 'reason; asks the project lead',
  docs: 'project documents {parent (root section title), title, markdown}',
  emails: 'external letters {to, subject, body}; only with done; sent after a person confirms',
  friction: 'what got in the way of the run; null if nothing (harness-retro collects it)',
  uncertain:
    'doubts about the result and what was checked; "" if none, not null (the engine checks it with the LLM)',
};

const fields = Object.keys(z.toJSONSchema(resultSchema).properties ?? {})
  .map((k) => `- ${k}: ${FIELD_DOC[k as keyof AiResult]}`)
  .join('\n');

// pack key -> actions of modules/ai/harnesses/<pack>/harness.yml (the test compares them with the files)
export const PACK_ACTIONS: Record<string, string[]> = {
  dev: [
    'plan',
    'decompose',
    'triage',
    'discussion',
    'assign',
    'mention',
    'checklist',
    'chat',
    'dev',
    'review',
    'test',
  ],
  hiring: [
    'assign',
    'chat',
    'checklist',
    'interview_questions',
    'interview_summary',
    'mention',
    'offer',
    'ping',
    'questionnaire',
    'rejection',
    'report',
    'screening',
  ],
  sales: [
    'assign',
    'chat',
    'checklist',
    'digest',
    'followup',
    'lost',
    'mention',
    'next_step',
    'proposal',
    'qualify',
    'research',
  ],
  support: [
    'triage',
    'draft_reply',
    'escalate_dev',
    'close',
    'to_wiki',
    'assign',
    'mention',
    'checklist',
    'chat',
  ],
};

const packs = Object.entries(PACK_ACTIONS)
  .map(([k, a]) => `- ${k}: ${a.join(', ')}`)
  .join('\n');

export const section = {
  id: 'runs',
  title: 'AI runs',
  body: `AI run kinds (what starts one): action (an automation rule), comment (a task comment assigned to the AI), mention (@ai), checklist (first open checklist item on the AI), chat (a message to the bot), doc_comment / doc_mention (document comments); confirm / resume continue a waiting run. One queued job per (task, action/item): a new event replaces it. A run started by another run's changes continues a chain of at most 10.
Run states: queued, running, waiting_human, waiting_subtasks, done, failed, cancelled.

Runtimes of an AI action (runtime):
- llm: one structured model call (connection of the instance, model overridable per action) answering with the result below.
- agent: a runner container with the repo of the project's GitLab connection (git push, glab); limits AI_AGENT_MAX_REPLICAS / project max_agents; stopped on no heartbeat (AI_AGENT_HEARTBEAT_TIMEOUT_SEC) or over AI_AGENT_TIMEOUT_MIN. Its result goes through the same apply as llm.

AI action of a project: key, name, description, pageId (the prompt is the text of that docs page, read at run time), runtime, model, questionStatusId (where the task goes while the AI waits for an answer), checks (readiness criteria), maxOutputTokens, maxAttempts (1-10; null = AI_MAX_ATTEMPTS, 3), review (every done result also goes to the LLM review).

Engine (PLNRAPP-404): a done result is accepted by the action's checks, not by the AI's own word — "$ command" checks run in the agent's container (exit code 0 passes; skipped for llm), the other checks and the result's uncertain go to a separate LLM check. Not accepted: the changes are not applied, the run is failed and the next attempt starts with the remarks; the attempts spent — a question to a person. A lost agent (no heartbeat, timeout) and a provider error are restarted within the attempts (the provider — after 60 s × attempt). Every 5 minutes the engine queues the tasks on the AI standing in a status where an enabled rule (task.status_changed with to) runs an action and matching its conditions, if the last run of the action is missing or failed with attempts left; a done or cancelled run is left alone. Engine decisions are lines "движок: …" in the run log.

Coordination (PLNRAPP-405): an action run lays the work out with newTasks {ai: true, after, checks} — the subtasks go to the AI, "after" makes "blocks" links from earlier subtasks of the list, checks become the section "Критерии приёмки" of the subtask's description (that section of any task adds to the checks of its action). A done run with unfinished subtasks on the AI (no action run yet, or one queued, running, waiting for a person or for its own subtasks) ends as waiting_subtasks without the acceptance; the outcome of a subtask's action run (accepted, a question, failed) runs the parent's action again with that event in the prompt — it starts the next wave, sends a subtask back (subtasks[].moveTo), asks a person (question) or finishes (done, accepted by its checks). A subtask with an open blocker does not start; at most max_agents of the project (default 1) subtasks of a waiting parent run at a time. The LLM review also runs on a subtask's repeated attempt and on every done result of an action with review. An agent of a subtask works in the branch of the open MR of the nearest ancestor. The AI usage of a task sums its subtasks.

Autopilot (PLNRAPP-408): a project setting next to the daily limits (AI settings of the project, admin, off by default). On — subtasks with ai: true go to the AI as above. Off — they go to a person (the task's assignee, else its author) in the action's question status ("Уточнение"), and the parent is accepted at once. Guard: at most dailyTasks tasks created by the AI per UTC day in the project (own value, else AI_DAILY_TASKS, default 50); the rest of newTasks are not created (a log line). The daily token / cost limits and the chain limit apply as before; a person gets only questions and spent attempts.

Harness pack: harness.yml (statuses, labels, fields, actions, rules, settings.questionStatus, events) + actions/<key>.md (frontmatter name, description, runtime, model, checks, attempts, review; body = prompt). In a project it is documents under "Harness-пакеты". events maps comment | mention | checklist | chat to an action key; no key = the built-in prompt. Catalog packs and their actions:
${packs}

Automation rule: action {type: ai_run, aiActionId, maxRuns?} (maxRuns: runs by this rule in a row on a task, 1-20; past it a question goes to a person). The rule's actions run first; the AI job is enqueued with a 10 s debounce and goes only if the task is still in the status it had after the rule. Creating or changing a rule with ai_run needs a project admin; the AI action must belong to the rule's project.

Run result (resultSchema; every field present, null = unused). Changes apply only with verdict done; with question only labels:
${fields}

Chat "да": in a chat the bot does not run dangerous tools (delete, bulk changes, pack and event settings). It returns needsConfirmation, saves the planned calls, sets the run to waiting_human and posts the plan. The initiator's reply "да" runs the planned calls once, as the initiator (their rights); any other reply cancels. Emails from a result wait the same way, for a confirming comment from the asker or the task's person.`,
};
