import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';
import { dropDb, testDbUrl } from '../db.js';

describe('wk13: удаление тестовых баз', () => {
  it('wk13: база файла вложена в шаблон прогона (teardown/страховка её найдёт)', () => {
    expect(new URL(testDbUrl()).pathname.slice(1).startsWith(`${inject('dbTemplate')}_`)).toBe(
      true,
    );
  });

  it('wk13: dropDb удаляет базу', async () => {
    const name = `${inject('dbTemplate')}_wk13${Date.now().toString(16)}`;
    const admin = new pg.Client({ connectionString: inject('dbAdminUrl') });
    await admin.connect();
    try {
      await admin.query(`create database ${name}`);
      await dropDb(admin, name);
      const r = await admin.query('select 1 from pg_database where datname = $1', [name]);
      expect(r.rowCount).toBe(0);
    } finally {
      await admin.end();
    }
  }, 80_000);
});
