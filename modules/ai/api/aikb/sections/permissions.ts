// Tool names below are checked against the MCP registry by apps/api/test/ai/aikb-permissions.test.ts.
// The "## " headings are the groups the test looks the tools up in.
export const section = {
  id: 'permissions',
  title: 'Whose rights tools run with, what needs a yes',
  body: `## Whose rights
- MCP needs a Bearer API token. Every tool runs as the token owner (a person): the same spaces, projects and project role as in the UI. No extra rights, no way around project access.
- A token with the read scope cannot call write tools. Read tools only return what the owner can see.
- An unknown project and a project without access look the same (not found / forbidden).

## Needs the user's yes (danger)
In chat these tools are not executed until the user confirms in the chat; ask first, say exactly what will change, then call. Settings tools (statuses, labels, fields, automations, AI actions, project, modules) are all here:
\`unlink_tasks\`, \`create_status\`, \`update_status\`, \`delete_status\`, \`create_label\`, \`update_label\`, \`delete_label\`, \`create_field\`, \`update_field\`, \`delete_field\`, \`create_automation\`, \`update_automation\`, \`delete_automation\`, \`create_ai_action\`, \`update_ai_action\`, \`delete_ai_action\`, \`update_project\`, \`set_project_module\`, \`batch_update_tasks\`.
- \`batch_update_tasks\` (bulk): \`dryRun: true\` only lists the tasks and needs no yes; the real run (up to 100 tasks) needs one yes for the whole batch.
- Deleting a status moves its tasks to \`replaceWith\`; deleting a label or a field removes it from tasks (a field with its values).

## Needs a yes only for some arguments (dangerIf)
Text that may come from a prompt injection: \`update_task\` when \`description\` is set; \`update_doc\` when \`markdown\`, \`append\` or \`replace\` is set. Other arguments of these tools (status, assignees, title) go without a yes.

## Writes without a yes
Allowed without a confirmation, still done as the token owner: \`create_task\`, \`add_comment\`, \`update_comment\`, \`link_tasks\`, \`log_time\`, \`start_timer\`, \`stop_timer\`, \`create_doc\`, \`link_doc_task\`, \`add_doc_comment\`, \`resolve_doc_comment\`, \`patch_doc\`.
Do not create tasks, comments or documents in bulk without a reason.

## Admin only
- AI pack tools \`ai_list_packs\`, \`ai_upload_pack\`, \`ai_diff_pack\`, \`ai_apply_pack\`, \`ai_set_pack_events\`: the token owner must be an admin of the project and the AI module must be on in the project, otherwise forbidden. \`ai_upload_pack\` and \`ai_apply_pack\` rewrite project documents and settings: confirm with the user before them (the registry has no automatic yes for these).
- A rule with the \`ai_run\` action can be created, changed or deleted only by a project admin (\`create_automation\`, \`update_automation\`, \`delete_automation\`).
- Restoring an archived task is a project-admin action.

## Read-only
\`list_spaces\`, \`list_projects\`, \`list_fields\`, \`project_dictionary\`, \`search_tasks\`, \`get_task\`, \`my_tasks\`, \`list_time_entries\`, \`get_timer\`, \`current_sprint\`, \`list_sprints\`, \`list_automations\`, \`list_docs\`, \`get_doc\`, \`list_doc_comments\`, \`list_ai_actions\`, \`search_docs_site\`.

## Not available via MCP (do not promise it; tell the user to do it in the UI)
- Secrets and connections: AI provider keys, SMTP/IMAP, GitLab tokens, webhook secrets, API tokens.
- Members and roles of a space or a project, users of the instance, blocking, passwords.
- Instance settings and instance modules, cloud settings, data export/import.
- Saved views (see the views section), dashboards, goals, templates, forms, chat channels.
- Creating or deleting spaces and projects, deleting or merging tasks, deleting documents.`,
};
