import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { db, flushPromises, ids, open, setup, until } from './h';

let w: VueWrapper;
let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});
afterEach(() => w?.unmount());

const T0 = Date.parse('2026-10-22T10:00:00.000Z');
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const comment = (text: string, s: number, over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  spaceId: ids.space,
  taskId: t.id,
  authorId: ids.ann,
  parentId: null,
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  mentions: [],
  assigneeId: null,
  resolvedAt: null,
  resolvedBy: null,
  editedAt: null,
  createdAt: at(s),
  updatedAt: at(s),
  ...over,
});
const tab = () => w.findAll('[role="tab"]').find((b) => b.text().startsWith('Назначенные'));

// PLNRAPP-561: the «Assigned» tab — assigned comments of the task, the counter as GET assigned-comments
describe('таб «Назначенные» (PLNRAPP-561)', () => {
  it('без назначенных комментариев таба нет', async () => {
    await db.table('comments').put(comment('просто текст', 1));
    w = await open();
    await until(() => w.find('[data-testid="tab-count-attachments"]').exists() || true);
    await flushPromises();
    expect(tab()).toBeUndefined();
  });

  it('счётчик «завершено/всего», незавершённые по хронологии, завершённые — в свёрнутом аккордеоне', async () => {
    await db
      .table('comments')
      .bulkPut([
        comment('второй открытый', 3, { assigneeId: ids.bob }),
        comment('первый открытый', 1, { assigneeId: ids.bob, authorId: ids.bob }),
        comment('без назначения', 2),
        comment('сделанный', 4, { assigneeId: ids.ann, resolvedAt: at(5), resolvedBy: ids.ann }),
      ]);
    w = await open();
    await until(() => w.find('[data-testid="tab-count-assigned"]').exists());
    // open 2, total 3 → resolved 1 of 3
    expect(w.find('[data-testid="tab-count-assigned"]').text()).toBe('1/3');
    await tab()!.trigger('click');
    await flushPromises();
    const open_ = w.get('[data-testid="assigned-open-list"]');
    const texts = open_.findAll('[data-testid="assigned-text"]').map((x) => x.text());
    expect(texts).toEqual(['первый открытый', 'второй открытый']);
    expect(w.get('[data-tab="assigned"]').text()).not.toContain('без назначения');
    // the second line: status, author, assignee, date
    const meta = open_.find('[data-testid="assigned-meta"]');
    expect(meta.text()).toContain('Не завершено');
    expect(meta.text()).toContain('Bob → Bob');
    expect(meta.find('time').attributes('datetime')).toBe(at(1));
    const acc = w.get('[data-testid="assigned-resolved"]');
    expect(acc.text()).toBe('Завершённые 1');
    expect(acc.attributes('aria-expanded')).toBe('false');
    expect(w.get('[data-tab="assigned"]').text()).not.toContain('сделанный');
    await acc.trigger('click');
    const done = w.get('[data-testid="assigned-resolved-list"]');
    expect(done.text()).toContain('сделанный');
    expect(done.text()).toContain('Завершено');
    expect(done.text()).toContain('Ann → Ann');
  });
});
