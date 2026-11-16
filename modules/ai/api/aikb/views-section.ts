/** Data the views-settings section is built from; no import from apps/api (rootDir), so the caller supplies it. */
export type ViewsMeta = {
  /** task filter: base field → allowed operators (FIELD_OPERATORS) */
  fieldOperators: Record<string, string[]>;
  /** custom field type → allowed operators of a `field:<id>` rule */
  customFieldOperators: Record<string, string[]>;
  /** saved-view mutators (view.*) */
  viewMutators: string[];
  /** MCP tools of saved views (from the registry) */
  viewTools: string[];
  /** MCP inputs of search_tasks / filter of batch_update_tasks */
  searchInputs: string[];
  batchFilterInputs: string[];
  /** MCP tools that change project settings */
  settingTools: string[];
};

const list = (xs: string[]) => xs.map((x) => `\`${x}\``).join(', ');

export function viewsSection(m: ViewsMeta): { id: 'views-settings'; title: string; body: string } {
  const fields = Object.entries(m.fieldOperators).map(([f, o]) => `- \`${f}\`: ${list(o)}`);
  const custom = Object.entries(m.customFieldOperators).map(([t, o]) => `${t}: ${list(o)}`);
  return {
    id: 'views-settings',
    title: 'Task views, filters and settings',
    body: [
      '## Filter language (packages/shared/src/filter.ts)',
      'A filter is `{op: "and"|"or", rules: [{field, operator, value?}]}`. Values: arrays of ids (`"me"` = current user; `"current"` for cycle = open sprint), a string or a number. Dates: `YYYY-MM-DD`, `today`, `today+N`, `today-N`. `isEmpty` / `isNotEmpty` take no value; a rule with an empty value is skipped. Fields and operators:',
      ...fields,
      `- \`field:<fieldDefId>\` (custom field), operators by field type: ${custom.join('; ')}`,
      '',
      '## Saved views',
      'A saved view (table `saved_views`, in a space) holds name, icon, layout, filter (the language above), config (view options: groupBy, sortBy, sortDir, showSubtasks, fields, columns, ...), rank; personal (userId set) or shared (userId null); `node` binds it to a built-in tab (workspace `w`, space `s:<id>`, project `p:<id>`).',
      `Mutators: ${list(m.viewMutators)}. Saved views over MCP and REST /api/v1/views (rights of the token owner: shared views and own personal ones of the user's spaces): ${list(m.viewTools)}. Reads need no confirmation; deleting a view needs the user's yes in chat. \`set_view_default\` sets the default view of a \`node\`.`,
      '',
      '## Finding tasks',
      `MCP \`search_tasks\` does not take the filter language; it takes flat inputs: ${list(m.searchInputs)}. \`my_tasks\` takes includeDone plus projectId, statusId, statusCategory, limit. The same flat names filter \`GET /api/v1/tasks\`.`,
      `\`batch_update_tasks\` (needs confirmation in chat; dryRun lists tasks without changes) selects tasks by taskIds or filter: ${list(m.batchFilterInputs)}.`,
      '',
      '## Settings',
      `Project settings via MCP (write, need the user's "yes" in chat; rights of the token owner): ${list(m.settingTools)}. They cover statuses, labels, custom fields, automation rules, AI actions, project fields and project modules; reads: list_fields, project_dictionary, list_ai_actions.`,
      'Not available via MCP unless the mcp section lists a tool for it: space settings, members and roles, user preferences, instance settings, secrets (AI connections, GitLab, mail, webhooks, AI limits).',
    ].join('\n'),
  };
}
