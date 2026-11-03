// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { label, labels, setup, stopAll } from './helpers';

afterEach(stopAll);

describe('pj17: replica of an older build', () => {
  it('pj17: курсор актуален, но схема реплики другая (или не записана) -> перезагрузка bootstrap', async () => {
    const s = setup();
    s.server.seed('labels', [label('a')]);
    const c = s.mk();
    await s.start(c);
    expect(s.server.bootstraps).toBe(1);
    await c.stopSync();

    // the same build restarts: the schema matches, the warm replica is not reloaded
    const c2 = s.mk();
    await s.start(c2);
    await c2.syncNow();
    expect(s.server.bootstraps).toBe(1);
    await c2.stopSync();

    // a replica of the old build: the cursor is current, the schema record is absent; rows added meanwhile
    // went to tables the old build did not have — only bootstrap brings them
    await s.db._meta.delete('schema');
    s.server.seed('labels', [label('b')]);
    s.server.log = []; // pull sees no changes: only the schema mismatch can trigger the reload
    const c3 = s.mk();
    await s.start(c3);
    await c3.syncNow();
    expect(s.server.bootstraps).toBe(2);
    expect((await labels(s.db)).map((x) => x.name).sort()).toEqual(['a', 'b']);
    expect((await s.db._meta.get('schema'))?.value).toBe(s.db.schemaSig());
    await c3.stopSync();
  });
});
