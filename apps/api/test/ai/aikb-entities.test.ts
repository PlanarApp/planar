import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { section } from '../../../../modules/ai/api/aikb/sections/entities';
import * as core from '../../src/db/schema';

const mods = import.meta.glob<Record<string, unknown>>('../../../../modules/*/api/schema.ts', {
  eager: true,
});
const pgTables = [core, ...Object.values(mods)].flatMap((m) =>
  Object.values(m).filter((v): v is PgTable => is(v, PgTable)),
);
const tables = new Set(pgTables.map((t) => getTableName(t)));

describe('aikb entities', () => {
  it('every lowercase backticked name in body (except `id`) is an existing table', () => {
    const names = [...section.body.matchAll(/`([a-z_]+)`/g)]
      .map((m) => m[1])
      .filter((n) => n !== 'id');
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(tables.has(n), n).toBe(true);
  });
  it('key tables are mentioned', () => {
    for (const t of [
      'spaces',
      'projects',
      'tasks',
      'statuses',
      'labels',
      'field_defs',
      'comments',
      'sprints_cycles',
      'docs_pages',
      'automations_rules',
      'ai_runs',
    ])
      expect(section.body).toContain(`\`${t}\``);
  });
  it('mentioned task columns exist', () => {
    const tasks = pgTables.find((t) => getTableName(t) === 'tasks') as unknown as Record<
      string,
      unknown
    >;
    for (const f of [
      'statusId',
      'parentId',
      'cycleId',
      'number',
      'dueDate',
      'completedAt',
      'fields',
    ]) {
      expect(tasks[f], f).toBeDefined();
      expect(section.body).toContain(f);
    }
  });
  it('status categories match the body', () => {
    for (const c of ['backlog', 'todo', 'in_progress', 'done', 'cancelled'])
      expect(section.body).toContain(c);
  });
});
