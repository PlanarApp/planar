import { describe, expect, it } from 'vitest';
import { FIELD_OPERATORS } from '@planar/shared';
import { toolDefs } from '../../src/mcp/tools.js';
import { SETTING_OPS } from '../../src/rest/settings.js';
import type { RestService } from '../../src/rest/rest.service.js';
import { taskFilter } from '../../src/rest/batch.js';
import { section } from '../../../../modules/ai/api/aikb/sections/views-settings.js';

const body = section.body;
const defs = toolDefs({} as RestService);
const has = (w: string) => expect(body).toContain(`\`${w}\``);

describe('aikb views-settings section', () => {
  it('every filter field and operator is in the body', () => {
    for (const [f, ops] of Object.entries(FIELD_OPERATORS)) {
      has(f);
      ops.forEach(has);
    }
    ['in', 'notIn', 'isEmpty', 'isNotEmpty', 'before', 'after', 'contains', 'gte', 'lte'].forEach(
      has,
    );
    has('field:<fieldDefId>');
  });
  it('every setting tool of the registry is in the body', () => {
    for (const n of [...SETTING_OPS.map((o) => o.tool), 'set_project_module']) has(n);
  });
  it('search_tasks and batch filter inputs are in the body', () => {
    const search = defs.find((d) => d.name === 'search_tasks')!;
    for (const k of Object.keys(search.shape)) has(k);
    for (const k of Object.keys(taskFilter.shape)) has(k);
  });
  it('view mutators and saved-view MCP status', () => {
    ['view.create', 'view.update', 'view.delete', 'view.setNodeDefault'].forEach(has);
    expect(defs.some((d) => /view/.test(d.name))).toBe(false);
    expect(body).toContain('not available via MCP');
  });
});
