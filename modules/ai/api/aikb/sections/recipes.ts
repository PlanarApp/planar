// Every call is written as `tool(arg, arg)`: apps/api/test/ai/aikb-recipes.test.ts checks tools and top-level argument names against the MCP registry.
export const section = {
  id: 'recipes',
  title: 'Recipes: MCP call sequences for common jobs',
  body: `Ids come from earlier calls, never guess them. Tools marked (yes) need the user's confirmation in chat (see permissions).

### Add a status, label or field
1. \`list_projects(spaceId)\` to find \`projectId\`; \`project_dictionary(projectId)\` for what exists (do not duplicate).
2. (yes) \`create_status(projectId, name, category)\`, or \`create_label(projectId, name, color)\`, or \`create_field(projectId, name, type, options)\`.
3. Change later with \`update_status(id, name, category)\`, \`update_label(id, name, color)\`, \`update_field(id, name, options)\`; the field type cannot change.

### Automation rule (trigger, condition, action)
1. \`list_automations(projectId)\` to see the rules; \`project_dictionary(projectId)\` for status, label and field ids; types are in the automations section.
2. (yes) \`create_automation(projectId, name, trigger, conditions, actions, enabled)\`; create it with \`enabled\` false first.
3. Show the rule to the user, then (yes) \`update_automation(id, enabled)\`. Remove with \`delete_automation(id)\`.
4. A rule with the ai_run action needs a project admin.

### Bind a harness action to an event
1. \`ai_list_packs(projectId)\`: the catalog, uploaded packs and current event bindings; \`list_ai_actions(projectId)\` for action keys.
2. Pack not in the project: \`ai_upload_pack(projectId, packKey, dryRun)\` first (conflicts only), then without \`dryRun\` (add \`resolve\` for conflicts).
3. \`ai_diff_pack(projectId, packPageId)\` to see the operations, then \`ai_apply_pack(projectId, packPageId)\`.
4. \`ai_set_pack_events(projectId, packKey, events)\`: events is {comment|mention|checklist|chat: action key}; an event without a key uses the built-in prompt. Admin only.

### Change many tasks at once
1. \`search_tasks(query, projectId, statusCategory, assigneeId, labelId)\` to see what matches.
2. \`batch_update_tasks(filter, patch, dryRun)\` with \`dryRun\` true: it only returns the task list. Show it to the user.
3. After the user's yes: the same call without \`dryRun\`. Or pass \`taskIds\` instead of \`filter\`. At most 100 tasks per call.

### Find tasks by filters
1. \`search_tasks(query, assigneeId, labelId, priority, dueBefore, dueAfter, unassigned, projectId, statusId, statusCategory, limit)\`; filters combine (see the views section for fields and operators).
2. Own tasks: \`my_tasks(includeDone, projectId, statusCategory)\`.
3. One task with comments and links: \`get_task(task)\` by id or key.

### Create a task with subtasks
1. \`project_dictionary(projectId)\` for status, label and member ids.
2. \`create_task(projectId, title, description, statusId, priority, dueDate, assigneeIds, labelIds)\`; keep the returned id.
3. For each subtask: \`create_task(projectId, title, parentId)\` with that id as \`parentId\`.

### Move tasks between statuses
1. \`project_dictionary(projectId)\` to get \`statusId\`.
2. One task: \`update_task(task, statusId)\`.
3. Several: \`batch_update_tasks(filter, patch, dryRun)\` as in "Change many tasks at once".

### Comment, assign, resolve
1. \`add_comment(task, text, assigneeId)\`; a reply sets \`parentId\`.
2. When done: \`update_comment(id, resolved)\`. Documents: \`add_doc_comment(pageId, text)\`, \`resolve_doc_comment(pageId, id)\`.

### Document linked to a task
1. \`list_docs(projectId, parentId)\` for the tree; \`get_doc(id, section)\` to read one section only.
2. \`create_doc(projectId, parentId, title, markdown)\`, then \`link_doc_task(pageId, task)\`.
3. Small edits: \`update_doc(id, replace)\` or \`patch_doc(pageId, edits)\`; the whole text is replaced only with \`markdown\` (yes).

### Time
1. \`log_time(task, minutes, date, note)\`, or \`start_timer(task)\` ... \`stop_timer()\`; \`get_timer()\` shows the running one.
2. Read: \`list_time_entries(taskId, userId, from, to, limit)\`.

### Give the user a link to an object
1. The instance address and the URL templates are in the common block (core) and the urls section; do not invent paths or an address.
2. Get the identifier first: the task key from \`get_task(task)\` or \`search_tasks(query)\`, a document id from \`list_docs(projectId)\`, a project id from \`list_projects(spaceId)\`.
3. Substitute it into the template; a comment link adds the comment id.`,
};
