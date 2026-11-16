export const section = {
  id: 'entities',
  title: 'Planar entities and relations',
  body: `Every entity is addressed by a uuid \`id\`; tasks also by a key.

- **Space** (table \`spaces\`): top-level container; fields name, description, leadId. Members: \`space_members\`. Owns projects.
- **Project** (table \`projects\`): fields spaceId, name, key (unique, e.g. \`PLNRAPP\`), description, leadId, defaultAssigneeId, archivedAt, modules (enabled modules), taskCounter. Members: \`project_members\`.
- **Task** (table \`tasks\`): fields projectId, number, parentId (subtask), statusId, title, description, priority (integer), dueDate, startDate, completedAt, fields (custom field values by field id), cycleId, archivedAt. Key = project key + "-" + number (\`KEY-n\`, unique per project); address by \`id\` or key. Related: \`task_assignees\` (taskId, userId), \`task_watchers\`, \`task_labels\` (taskId, labelId), \`task_links\` (links between tasks), \`checklist_items\`, \`attachments\`.
- **Status** (table \`statuses\`): per project; fields projectId, name, category, rank. Category is one of backlog, todo, in_progress, done, cancelled. A task's statusId points here; the task's completedAt is its completion timestamp.
- **Label** (table \`labels\`): per project; name, color; attached to tasks via \`task_labels\`.
- **Custom field** (table \`field_defs\`): per project; name, type (text, number, date, select, user, url, money), options. Values live in tasks.fields keyed by field_defs.id.
- **Comment** (table \`comments\`): on a task; taskId, authorId, parentId (reply to another comment), body (rich text), mentions (user ids), assigneeId (comment assigned to a user), resolvedAt.
- **Cycle / sprint** (table \`sprints_cycles\`): per project; number (unique per project), name, startDate, endDate, closedAt. A task joins via tasks.cycleId.
- **Doc page** (table \`docs_pages\`): wiki page in a space, optionally projectId; parentId (page tree), title, body, text (plain), archivedAt. Linked to tasks via \`docs_task_links\`; comments in \`docs_comments\`.
- **Automation** (table \`automations_rules\`): per project; name, enabled, trigger, conditions, actions (JSON). Executions: \`automations_runs\` (ruleId, taskId, status ok|skipped|error).
- **AI run** (table \`ai_runs\`): one AI execution; kind (action, comment, mention, checklist, chat), state (running, waiting_human, done, failed, cancelled), taskId (null for chat), pageId, projectId, channelId, chainId, token counts, cost, log. Events: \`ai_run_events\`.
- **User** (table \`users\`): referenced by createdBy, authorId, leadId, userId fields.`,
};
