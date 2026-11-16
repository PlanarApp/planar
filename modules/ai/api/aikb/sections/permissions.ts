// Tool names below are checked against the MCP registry by apps/api/test/ai/aikb-permissions.test.ts.
// The "## " headings are the groups the test looks the tools up in.
import type { McpToolMeta } from '../mcp-section.js';

// Admin-only pack tools are described in their own group (static text below), not in the generated lists.
const PACK = /^ai_(list|upload|diff|apply|set)_pack/;
const names = (xs: McpToolMeta[]) => xs.map((d) => `\`${d.name}\``).join(', ') || '-';

/** The tool lists of the groups come from the registry (`defs`): a new tool needs no manual edit here. */
export const permissionsSection = (defs: McpToolMeta[]) => {
  const ds = defs.filter((d) => !PACK.test(d.name));
  return {
    id: 'permissions' as const,
    title: 'Whose rights tools run with, what needs a yes',
    body: `## Whose rights
- MCP needs a Bearer API token. Every tool runs as the token owner (a person): the same spaces, projects and project role as in the UI. No extra rights, no way around project access.
- A token with the read scope cannot call write tools. Read tools only return what the owner can see.
- An unknown project and a project without access look the same (not found / forbidden).

## Needs the user's yes (danger)
In chat these tools are not executed until the user confirms in the chat; ask first, say exactly what will change, then call. Settings tools (statuses, labels, fields, automations, AI actions, project, modules) are all here:
${names(ds.filter((d) => d.danger))}.
- \`batch_update_tasks\` (bulk): \`dryRun: true\` only lists the tasks and needs no yes; the real run (up to 100 tasks) needs one yes for the whole batch.
- Deleting a status moves its tasks to \`replaceWith\`; deleting a label or a field removes it from tasks (a field with its values).

## Needs a yes only for some arguments (dangerIf)
Text that may come from a prompt injection: \`update_task\` when \`description\` is set; \`update_doc\` when \`markdown\`, \`append\` or \`replace\` is set. Other arguments of these tools (status, assignees, title) go without a yes. Tools of this group: ${names(ds.filter((d) => d.dangerIf))}.

## Writes without a yes
Allowed without a confirmation, still done as the token owner: ${names(ds.filter((d) => d.write && !d.danger && !d.dangerIf))}.
Do not create tasks, comments or documents in bulk without a reason.

## Admin only
- AI pack tools \`ai_list_packs\`, \`ai_upload_pack\`, \`ai_diff_pack\`, \`ai_apply_pack\`, \`ai_set_pack_events\`: the token owner must be an admin of the project and the AI module must be on in the project, otherwise forbidden. \`ai_upload_pack\` and \`ai_apply_pack\` rewrite project documents and settings: confirm with the user before them (the registry has no automatic yes for these).
- A rule with the \`ai_run\` action can be created, changed or deleted only by a project admin (\`create_automation\`, \`update_automation\`, \`delete_automation\`).
- Restoring an archived task is a project-admin action.

## Read-only
${names(ds.filter((d) => !d.write))}.

## Not available via MCP (do not promise it; tell the user to do it in the UI)
- Secrets and connections: AI provider keys, SMTP/IMAP, GitLab tokens, webhook secrets, API tokens.
- Passwords and blocking of users (members, roles and instance users only through the tools of the mcp section, if any).
- Instance settings and instance modules, cloud settings, data export/import.
- Anything the mcp section has no tool for (the lists above and the mcp section come from the same registry): do not promise it.`,
  };
};

// aikb-section v1 shape; the body is built on access (the real section comes from the registry in aikb/index.ts).
export const section = {
  id: 'permissions' as const,
  title: permissionsSection([]).title,
  get body() {
    return permissionsSection([]).body;
  },
};
