// PJ-11b: settings section «Участники» of a project — mode switch, own composition, read-only for non-admins
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { useAuth, type User } from '../../../auth/useAuth';
import { db, ids, menuAct, setup, show, wait } from './setup';
import ProjectMembersSettings from '../ProjectMembersSettings.vue';

setup();

const mount = () => show(ProjectMembersSettings, { projectId: ids.project });
const names = (w: Awaited<ReturnType<typeof mount>>) =>
  w.findAll('[data-testid=pmember-row]').map((r) => r.text());
const own = () => db.table('projectMembers').toArray();

describe('pj11b: участники проекта', () => {
  it('pj11b без перекрытия — состав пространства, только чтение', async () => {
    const w = await mount();
    expect(names(w)).toHaveLength(2);
    expect(names(w).join()).toContain('Ann');
    expect(names(w).join()).toContain('Bob');
    expect(w.find('[data-testid=pmember-add]').exists()).toBe(false);
    expect(w.find('[data-testid=row-menu]').exists()).toBe(false);
    expect((w.find('[data-testid=mode-inherit]').element as HTMLInputElement).checked).toBe(true);
  });

  it('pj11b «Свой состав» передаёт текущий состав пространства с ролями; убрать и добавить', async () => {
    const w = await mount();
    await w.find('[data-testid=mode-custom]').setValue(true);
    await wait();
    expect((await db.table('projects').get(ids.project)).membersMode).toBe('custom');
    expect((await own()).map((m) => [m.userId, m.role]).sort()).toEqual(
      [
        [ids.ann, 'admin'],
        [ids.bob, 'member'],
      ].sort(),
    );
    // the screen follows the replica asynchronously
    await vi.waitFor(() => expect(w.find('[data-testid=pmember-add]').exists()).toBe(true));

    const bob = w.findAll('[data-testid=pmember-row]').find((r) => r.text().includes('Bob'))!;
    await menuAct(bob.find('[data-testid=row-menu]').element, 'Убрать', true);
    await vi.waitFor(async () => expect((await own()).map((m) => m.userId)).toEqual([ids.ann]));
    await vi.waitFor(() => expect(names(w)).toHaveLength(1));
  });

  it('pj11b назад «Как в пространстве» — перекрытие снято', async () => {
    const w = await mount();
    await w.find('[data-testid=mode-custom]').setValue(true);
    // the screen follows the replica asynchronously
    await vi.waitFor(() => expect(w.find('[data-testid=pmember-add]').exists()).toBe(true));
    await w.find('[data-testid=mode-inherit]').setValue(true);
    await vi.waitFor(async () =>
      expect((await db.table('projects').get(ids.project)).membersMode).toBe('inherit'),
    );
    await vi.waitFor(async () => expect(await own()).toEqual([]));
  });

  it('pj11b не админ пространства — переключатель заблокирован', async () => {
    await db.table('spaceMembers').where('userId').equals(ids.ann).modify({ role: 'member' });
    const w = await mount();
    expect(
      w.findAll('input[type=radio]').every((i) => (i.element as HTMLInputElement).disabled),
    ).toBe(true);
    useAuth().user.value = { id: ids.ann, role: 'owner' } as User;
    const w2 = await mount();
    expect(
      w2.findAll('input[type=radio]').every((i) => !(i.element as HTMLInputElement).disabled),
    ).toBe(true);
  });
});
