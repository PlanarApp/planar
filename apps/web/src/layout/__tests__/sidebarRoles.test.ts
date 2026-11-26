import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useAuth, type User } from '../../auth/useAuth';
import { db, i18n, ids, setup } from '../../screens/settings/__tests__/setup';
import { useSidebarActions } from '../sidebarActions';

setup();

// roles audit 2026-11-26: the sidebar menus offer only what the role allows
const labels = (items: object[]) =>
  items.map((i) => (i as { id?: string }).id).filter((x): x is string => !!x);
function menus() {
  let act!: ReturnType<typeof useSidebarActions>;
  mount(
    defineComponent({
      setup() {
        act = useSidebarActions();
        return () => null;
      },
    }),
    { global: { plugins: [i18n] } },
  );
  const space = { id: ids.space, name: 'S', color: null, icon: null, projects: [] };
  const project = { id: ids.project, name: 'P', prefix: 'P', color: null, icon: null };
  return {
    space: () => labels(act.spaceItems(space)),
    project: () => labels(act.projectItems(project)),
  };
}
const role = (r: string) =>
  db.table('spaceMembers').where('userId').equals(ids.ann).modify({ role: r });

describe('меню сайдбара по ролям', () => {
  it('admin спейса: всё', async () => {
    const m = menus();
    await vi.waitFor(() => expect(m.project()).toContain('delete'));
    expect(m.project()).toEqual(expect.arrayContaining(['rename', 'settings', 'archive']));
    expect(m.space()).toEqual(expect.arrayContaining(['new', 'rename', 'settings', 'delete']));
  });

  it('member: проект — без переименования, архива и удаления; спейс — только создание и настройки', async () => {
    await role('member');
    const m = menus();
    await vi.waitFor(() => expect(m.space()).toContain('new'));
    expect(m.project()).toContain('settings');
    for (const x of ['rename', 'archive', 'delete']) expect(m.project()).not.toContain(x);
    for (const x of ['rename', 'delete']) expect(m.space()).not.toContain(x);
  });

  it('guest спейса: без создания проекта и настроек', async () => {
    await role('guest');
    const m = menus();
    await vi.waitFor(() => expect(m.space()).toContain('fav'));
    await new Promise((r) => setTimeout(r, 50));
    for (const x of ['new', 'settings', 'rename', 'delete']) expect(m.space()).not.toContain(x);
    for (const x of ['settings', 'rename', 'archive', 'delete'])
      expect(m.project()).not.toContain(x);
  });

  it('админ инстанса без членства: всё, как admin спейса', async () => {
    await db.table('spaceMembers').where('userId').equals(ids.ann).delete();
    await db.table('users').update(ids.ann, { role: 'admin' });
    useAuth().user.value = { id: ids.ann, role: 'admin' } as User;
    const m = menus();
    await vi.waitFor(() => expect(m.project()).toContain('delete'));
    expect(m.space()).toEqual(expect.arrayContaining(['new', 'rename', 'settings', 'delete']));
  });
});
