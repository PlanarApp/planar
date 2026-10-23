import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { domainMutators } from '@planar/shared';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { ids, reset, task, until } from '../../tasks/__tests__/data';
import { effectScope } from 'vue';
import { linkTasks, unlinkTasks, useBlockedIds, useTaskLinks } from '..';
import LinksBlock from '../LinksBlock.vue';

vi.mock('../../views', async (orig) => ({ ...(await orig<object>()), openTask: vi.fn() }));

const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});
const rows = () => db.table('taskLinks').toArray();
let a: ReturnType<typeof task>, b: ReturnType<typeof task>, c: ReturnType<typeof task>;

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  await stopSync();
  await reset();
  await startSync({
    userId: ids.ann,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
  await db._queue.clear();
  [a, b, c] = [task(1), task(2), task(3)];
  await db.table('tasks').bulkPut([a, b, c]);
});

const sides = async (id: string) => {
  const r = effectScope().run(() => useTaskLinks(id))!;
  await until(() => r.value);
  return r.value!.map((l) => [l.side, l.otherId]);
};

describe('links-ui:side', () => {
  it('links-ui: blocks видна как blocks и blockedBy', async () => {
    await linkTasks(a.id, b.id, 'blocks');
    expect(await sides(a.id)).toEqual([['blocks', b.id]]);
    expect(await sides(b.id)).toEqual([['blockedBy', a.id]]);
  });
  it('links-ui: duplicates видна как duplicates и duplicatedBy', async () => {
    await linkTasks(a.id, b.id, 'duplicates');
    expect(await sides(a.id)).toEqual([['duplicates', b.id]]);
    expect(await sides(b.id)).toEqual([['duplicatedBy', a.id]]);
  });
  it('links-ui: relates симметрична', async () => {
    await linkTasks(a.id, b.id, 'relates');
    expect(await sides(a.id)).toEqual([['relates', b.id]]);
    expect(await sides(b.id)).toEqual([['relates', a.id]]);
  });
  it('links-ui: blockedBy меняет задачи местами', async () => {
    await linkTasks(a.id, b.id, 'blockedBy');
    expect(await rows()).toMatchObject([{ taskId: b.id, targetId: a.id, kind: 'blocks' }]);
  });
});

describe('links-ui:blocked', () => {
  it('links-ui: заблокирована, пока блокирующая не завершена', async () => {
    await linkTasks(a.id, b.id, 'blocks');
    const r = effectScope().run(() => useBlockedIds(ids.project))!;
    await until(() => r.value.has(b.id) || undefined);
    expect(r.value.has(a.id)).toBe(false);
    await db.table('tasks').update(a.id, { completedAt: '2026-10-22T11:00:00.000Z' });
    await until(() => !r.value.has(b.id) || undefined);
  });
});

describe('links-ui:block', () => {
  const mountBlock = () =>
    mount(LinksBlock, {
      props: { task: a as never },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
  it('links-ui: поиск исключает саму задачу и уже связанные', async () => {
    await linkTasks(a.id, b.id, 'relates');
    const w = mountBlock();
    await w.find('input').setValue('t');
    await until(() => w.findAll('[data-testid=candidate]').length || undefined);
    const txt = w.findAll('[data-testid=candidate]').map((x) => x.text());
    expect(txt).toHaveLength(1);
    expect(txt[0]).toContain('t3');
  });
  it('links-ui: удаление вызывает link.delete', async () => {
    const id = await linkTasks(a.id, b.id, 'relates');
    const w = mountBlock();
    await until(() => w.find('[data-testid=unlink]').exists() || undefined);
    await w.find('[data-testid=unlink]').trigger('click');
    await flushPromises();
    expect((await rows()).find((r) => r.id === id)).toBeUndefined();
    await unlinkTasks(id); // повторное удаление ничего не делает
  });
  it('links-ui: conflict показывает сообщение', async () => {
    const w = mountBlock();
    await w.find('input').setValue('t2');
    const btn = await until(
      () => w.find('[data-testid=candidate]').exists() && w.find('[data-testid=candidate]'),
    );
    // два клика по одной устаревшей кнопке: второй создаёт повторную пару
    await btn.trigger('click');
    await btn.trigger('click');
    await until(() => w.find('[role=alert]').exists() || undefined);
    expect(w.find('[role=alert]').text()).toBe(ru.links.conflict);
  });
});
