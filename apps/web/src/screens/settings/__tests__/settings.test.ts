import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { useAuth, type User } from '../../../auth/useAuth';
import * as http from '../../../api/http';
import { db, ids, menuAct, pick, setup, show, wait } from './setup';
import SpacesSettings from '../SpacesSettings.vue';
import MembersSettings from '../MembersSettings.vue';
import ProjectsSettings from '../ProjectsSettings.vue';
import StatusesSettings from '../StatusesSettings.vue';
import LabelsSettings from '../LabelsSettings.vue';
import ModulesSettings from '../ModulesSettings.vue';

setup();
const rows = (t: string) => db.table(t).toArray();

describe('settings:spaces', () => {
  it('создаёт пространство с 5 статусами и участником', async () => {
    const w = await show(SpacesSettings, {});
    await w.find('input[data-testid=space-new]').setValue('Новое');
    await w.find('form').trigger('submit');
    await wait();
    const s = (await rows('spaces')).find((x) => x.name === 'Новое');
    expect(s).toBeTruthy();
    expect(await db.table('statuses').where('spaceId').equals(s.id).count()).toBe(5);
    expect(await db.table('spaceMembers').where('spaceId').equals(s.id).count()).toBe(1);
  });
  it('переименовывает', async () => {
    const w = await show(SpacesSettings, {});
    const input = w.find('[data-testid=space-row] input');
    await input.setValue('Другое');
    await input.trigger('change');
    await wait();
    expect((await db.table('spaces').get(ids.space)).name).toBe('Другое');
  });
  it('удаление пространства с проектами — conflict, текст показан', async () => {
    const w = await show(SpacesSettings, {});
    await menuAct(
      w.find('[data-testid=space-row] [data-testid=row-menu]').element,
      'Удалить',
      true,
    );
    await vi.waitFor(() => expect(w.find('[role=alert]').text()).toContain('есть проекты'));
    expect(await db.table('spaces').get(ids.space)).toBeTruthy();
  });
});

describe('settings:members', () => {
  it('добавляет участника', async () => {
    await db.table('spaceMembers').where('userId').equals(ids.bob).delete();
    await db.table('users').update(ids.bob, { deactivatedAt: null });
    const w = await show(MembersSettings);
    expect(w.findAll('[data-testid=member-row]')).toHaveLength(1);
    await pick(w.findAll('button[role=combobox]')[0].element);
    await w.find('form').trigger('submit');
    await wait();
    expect(await db.table('spaceMembers').where('userId').equals(ids.bob).count()).toBe(1);
  });
  it('меняет роль', async () => {
    const bob = (await rows('spaceMembers')).find((m) => m.userId === ids.bob);
    const w = await show(MembersSettings);
    await pick(
      w
        .findAll('[data-testid=member-row]')
        .find((r) => r.text().includes('Bob'))!
        .find('button[role=combobox]').element,
      'Гость',
    );
    expect((await db.table('spaceMembers').get(bob.id)).role).toBe('guest');
  });
  it('последний admin — conflict, текст показан', async () => {
    const w = await show(MembersSettings);
    const annRow = w.findAll('[data-testid=member-row]').find((r) => r.text().includes('Ann'))!;
    const ann = (await rows('spaceMembers')).find((m) => m.userId === ids.ann);
    await menuAct(annRow.find('[data-testid=row-menu]').element, 'Убрать', true);
    await vi.waitFor(() => expect(w.find('[role=alert]').text()).toContain('последний admin'));
    expect(await db.table('spaceMembers').get(ann.id)).toBeTruthy();
  });
});

describe('settings:projects', () => {
  it('неверный ключ не отправляется', async () => {
    const w = await show(ProjectsSettings);
    await w.find('input[data-testid=project-name]').setValue('X');
    await w.find('input[data-testid=project-key]').setValue('1a');
    await w.find('form').trigger('submit');
    await wait();
    expect(await db._queue.count()).toBe(0);
    expect(w.text()).toContain('A–Z');
  });
  it('создаёт с верным ключом и архивирует', async () => {
    const w = await show(ProjectsSettings);
    await w.find('input[data-testid=project-name]').setValue('Новый');
    await w.find('input[data-testid=project-key]').setValue('NEW');
    await w.find('form').trigger('submit');
    await wait();
    const p = (await rows('projects')).find((x) => x.key === 'NEW');
    expect(p).toBeTruthy();
    const i = (await w.findAll('[data-testid=project-row]')).findIndex((r) =>
      r.text().includes('NEW'),
    );
    await menuAct(
      w.findAll('[data-testid=project-row] [data-testid=row-menu]')[i].element,
      'В архив',
    );
    expect((await db.table('projects').get(p.id)).archivedAt).toBeTruthy();
  });
  it('удаление проекта с задачами — conflict', async () => {
    const { task } = await import('../../../tasks/__tests__/data');
    await db.table('tasks').put(task(1));
    const w = await show(ProjectsSettings);
    const i = w.findAll('[data-testid=project-row]').findIndex((r) => r.text().includes('PLN'));
    await menuAct(
      w.findAll('[data-testid=project-row] [data-testid=row-menu]')[i].element,
      'Удалить',
      true,
    );
    await vi.waitFor(() => expect(w.find('[role=alert]').text()).toContain('есть задачи'));
  });
});

describe('settings:statuses', () => {
  it('создаёт статус', async () => {
    const w = await show(StatusesSettings);
    await w.find('input[data-testid=status-new]').setValue('Review');
    await w.find('form').trigger('submit');
    await wait();
    expect((await rows('statuses')).some((s) => s.name === 'Review')).toBe(true);
  });
  it('перетаскивание: rank между соседями', async () => {
    const mk = (name: string, rank: string) => ({
      id: uuidv7(),
      spaceId: ids.space,
      name,
      category: 'todo',
      color: '#888',
      rank,
      createdAt: '2026-10-22T10:00:00.000Z',
      updatedAt: '2026-10-22T10:00:00.000Z',
    });
    const [a, b, c] = [mk('A', 'a3'), mk('B', 'a4'), mk('C', 'a5')];
    await db.table('statuses').bulkPut([a, b, c]);
    const w = await show(StatusesSettings);
    // todo: Todo(a1), A, B, C; переносим C на индекс 1 (между Todo и A)
    (w.vm as unknown as { move(id: string, c: string, i: number): Promise<boolean> }).move?.(
      c.id,
      'todo',
      1,
    );
    await wait();
    const r = (await db.table('statuses').get(c.id)).rank as string;
    expect(r > 'a1' && r < 'a3').toBe(true);
  });
  it('удаление со сменой статуса задач', async () => {
    const { task } = await import('../../../tasks/__tests__/data');
    const t = task(1);
    await db.table('tasks').put(t);
    const w = await show(StatusesSettings);
    const i = w
      .findAll('[data-testid=status-row]')
      .findIndex((r) => (r.find('input').element as HTMLInputElement).value === 'Todo');
    await menuAct(
      w.findAll('[data-testid=status-row] [data-testid=row-menu]')[i].element,
      'Удалить',
    );
    await pick(document.body.querySelector('[role=dialog] button[role=combobox]')!);
    (document.body.querySelector('[data-testid=confirm]') as HTMLElement).click();
    await wait();
    expect(await db.table('statuses').get(ids.todo)).toBeUndefined();
    expect((await db.table('tasks').get(t.id)).statusId).toBe(ids.done);
  });
});

describe('settings:labels', () => {
  it('создаёт метку', async () => {
    const w = await show(LabelsSettings);
    await w.find('input[data-testid=label-new]').setValue('feat');
    await w.find('form').trigger('submit');
    await wait();
    expect((await rows('labels')).some((l) => l.name === 'feat')).toBe(true);
  });
  it('удаляет метку', async () => {
    const w = await show(LabelsSettings);
    await menuAct(
      w.find('[data-testid=label-row] [data-testid=row-menu]').element,
      'Удалить',
      true,
    );
    expect(await db.table('labels').get(ids.bug)).toBeUndefined();
  });
});

describe('settings:modules', () => {
  const serve = async () => {
    await db.table('settings').put({ id: 'enabled_modules', value: ['alpha'], updatedAt: 'x' });
    return vi.spyOn(http, 'api').mockResolvedValue({
      modules: [
        { id: 'alpha', enabled: true },
        { id: 'beta', enabled: false },
      ],
    });
  };
  it('показывает список с сервера', async () => {
    await serve();
    useAuth().user.value = { id: ids.ann, role: 'admin' } as User;
    const w = await show(ModulesSettings, {});
    expect(w.findAll('[data-testid=module-row]')).toHaveLength(2);
    expect((w.findAll('input')[0].element as HTMLInputElement).checked).toBe(true);
  });
  it('переключатель пишет settings.set', async () => {
    await serve();
    useAuth().user.value = { id: ids.ann, role: 'admin' } as User;
    const w = await show(ModulesSettings, {});
    await w.findAll('input')[1].setValue(true);
    await wait();
    expect((await db.table('settings').get('enabled_modules')).value.sort()).toEqual([
      'alpha',
      'beta',
    ]);
  });
  it('не админ: переключатели заблокированы', async () => {
    await serve();
    const w = await show(ModulesSettings, {});
    expect(w.findAll('input').every((i) => (i.element as HTMLInputElement).disabled)).toBe(true);
  });
});
