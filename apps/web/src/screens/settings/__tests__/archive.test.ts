// PLNRAPP-154: settings section «Архив» of a project — archived tasks with who/when, restore for an admin only
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { task } from '../../../tasks/__tests__/data';
import { db, ids, setup, show } from './setup';
import ArchiveSettings from '../ArchiveSettings.vue';

setup();

const AT = '2026-11-01T10:00:00.000Z';
const mount = () => show(ArchiveSettings, { projectId: ids.project });
const seed = async () => {
  const parent = task(1, { title: 'Старая', archivedAt: AT, archivedBy: ids.ann });
  const sub = task(2, {
    title: 'Подзадача',
    parentId: parent.id,
    archivedAt: AT,
    archivedBy: ids.ann,
  });
  await db.table('tasks').bulkPut([parent, sub, task(3, { title: 'Живая' })]);
  return parent;
};

describe('archive: раздел настроек проекта', () => {
  it('баннер о 30 днях; верх архивного поддерева с автором; админ восстанавливает', async () => {
    const parent = await seed();
    const w = await mount();
    expect(w.get('[data-testid=archive-retention]').text()).toContain('30 дней');
    await vi.waitFor(() => expect(w.findAll('[data-testid=archive-row]')).toHaveLength(1));
    const row = w.get('[data-testid=archive-row]');
    expect(row.text()).toContain('Старая');
    expect(row.text()).toContain('Ann');
    await row.get('[data-testid=archive-restore]').trigger('click');
    await vi.waitFor(async () =>
      expect((await db.table('tasks').get(parent.id)).archivedAt).toBeNull(),
    );
  });

  it('не админ — без «Восстановить», с пояснением', async () => {
    await db.table('spaceMembers').where('userId').equals(ids.ann).modify({ role: 'member' });
    await seed();
    const w = await mount();
    await vi.waitFor(() => expect(w.findAll('[data-testid=archive-row]')).toHaveLength(1));
    expect(w.find('[data-testid=archive-restore]').exists()).toBe(false);
    expect(w.get('[data-testid=archive-retention]').text()).toContain('администратор');
  });
});
