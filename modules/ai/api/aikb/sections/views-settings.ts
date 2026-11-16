import { FIELD_OPERATORS, operatorsFor, domainMutators, entitySchemas } from '@planar/shared';
import { viewsSection } from '../views-section.js';

const types = entitySchemas.fieldDefs.shape.type.options;
const defs = (t: (typeof types)[number]) =>
  [{ id: 'x', type: t }] as unknown as Parameters<typeof operatorsFor>[1];

// MCP lists below are not importable from apps/api (rootDir); apps/api/test/ai/aikb-views.test.ts checks them against the registry.
export const section = viewsSection({
  fieldOperators: FIELD_OPERATORS,
  customFieldOperators: Object.fromEntries(types.map((t) => [t, operatorsFor('field:x', defs(t))])),
  viewMutators: domainMutators.map((m) => m.name).filter((n) => n.startsWith('view.')),
  searchInputs: [
    'query',
    'assigneeId',
    'labelId',
    'priority',
    'dueBefore',
    'dueAfter',
    'unassigned',
    'archived',
    'projectId',
    'statusId',
    'statusCategory',
    'limit',
  ],
  batchFilterInputs: [
    'query',
    'projectId',
    'statusId',
    'statusCategory',
    'assigneeId',
    'labelId',
    'priority',
    'dueBefore',
    'dueAfter',
    'unassigned',
    'archived',
  ],
  settingTools: [
    'create_status',
    'update_status',
    'delete_status',
    'create_label',
    'update_label',
    'delete_label',
    'create_field',
    'update_field',
    'delete_field',
    'create_automation',
    'update_automation',
    'delete_automation',
    'create_ai_action',
    'update_ai_action',
    'delete_ai_action',
    'update_project',
    'set_project_module',
  ],
});
