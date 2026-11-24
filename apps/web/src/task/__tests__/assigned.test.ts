import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { useAuth } from '../../auth/useAuth';
import { router } from '../../router';
import { db, flushPromises, ids, open, queued, setup, stubFetch, until } from './h';

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

  it('все назначенные завершены — таб без числа (PLNRAPP-819)', async () => {
    await db
      .table('comments')
      .put(
        comment('сделанный', 1, { assigneeId: ids.ann, resolvedAt: at(2), resolvedBy: ids.ann }),
      );
    w = await open();
    await until(() => !!tab());
    await flushPromises();
    expect(w.find('[data-testid="tab-count-assigned"]').exists()).toBe(false);
  });

  it('счётчик — незавершённые (PLNRAPP-819), незавершённые по хронологии, завершённые — в свёрнутом аккордеоне', async () => {
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
    // open 2 of 3 → the count is 2
    expect(w.find('[data-testid="tab-count-assigned"]').text()).toBe('2');
    await tab()!.trigger('click');
    await flushPromises();
    const open_ = w.get('[data-testid="assigned-open-list"]');
    const texts = open_.findAll('[data-testid="assigned-text"]').map((x) => x.text());
    expect(texts).toEqual(['первый открытый', 'второй открытый']);
    expect(w.get('[data-tab="assigned"]').text()).not.toContain('без назначения');
    // the second line: status, author, assignee, date
    // the users (names) come from their own query — under load later than the comments
    const meta = () => w.get('[data-testid="assigned-open-list"] [data-testid="assigned-meta"]');
    await until(() => meta().text().includes('Bob → Bob'));
    expect(meta().text()).toContain('Не завершено');
    expect(meta().find('time').attributes('datetime')).toBe(at(1));
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

// PLNRAPP-562: from the tab — the jump to the comment in the feed and «Resolve» right in the row
describe('таб «Назначенные»: переход и отметка «выполнено» (PLNRAPP-562)', () => {
  it('клик по элементу прокручивает ленту к комментарию и подсвечивает его', async () => {
    const scrolled: Element[] = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {
      scrolled.push(this);
    };
    // the app router (the feed watches ?comment= there) — its guard asks /api/auth/me and /api/setup
    stubFetch((_, path) =>
      path === '/api/auth/me'
        ? [200, { user: useAuth().user.value }]
        : path === '/api/setup'
          ? [200, { needed: false, tokenRequired: false, demo: false, demoResetHours: 24 }]
          : undefined,
    );
    await router.push('/t/PLN-1');
    try {
      const c = comment('найди меня', 1, { assigneeId: ids.bob });
      await db.table('comments').bulkPut([c, comment('другой', 2)]);
      w = await open();
      await until(() => !!tab());
      await tab()!.trigger('click');
      await flushPromises();
      await w.get(`[data-tab="assigned"] [data-comment-id="${c.id}"]`).trigger('click');
      await until(() => scrolled.length > 0);
      const el = scrolled[0] as HTMLElement;
      expect(el.getAttribute('data-comment')).toBe(c.id);
      expect(el.classList.contains('comment-flash')).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });

  it('«выполнено» из таба переносит элемент в аккордеон, обновляет счётчик и статус в ленте', async () => {
    const c = comment('сделать отчёт', 1, { assigneeId: ids.ann, authorId: ids.bob });
    await db.table('comments').bulkPut([c, comment('ещё одно', 2, { assigneeId: ids.bob })]);
    w = await open();
    await until(() => w.find('[data-testid="tab-count-assigned"]').exists());
    expect(w.get('[data-testid="tab-count-assigned"]').text()).toBe('2');
    await tab()!.trigger('click');
    await flushPromises();
    const btn = () =>
      w
        .findAll('[data-tab="assigned"] li')
        .find((li) => li.text().includes('сделать отчёт'))!
        .get('[data-testid="assigned-resolve"]');
    expect(btn().attributes('aria-pressed')).toBe('false');
    await btn().trigger('click');
    await until(() => w.get('[data-testid="tab-count-assigned"]').text() === '1');
    expect((await queued('comment.resolve')).map((q) => q.args)).toEqual([
      { id: c.id, resolved: true },
    ]);
    expect(w.get('[data-testid="assigned-open-list"]').text()).not.toContain('сделать отчёт');
    expect(w.get('[data-testid="assigned-resolved"]').text()).toBe('Завершённые 1');
    // the feed shows the same status
    const inFeed = w.get(`[data-comment="${c.id}"] [data-testid="comment-resolve"]`);
    expect(inFeed.attributes('aria-pressed')).toBe('true');
    // and back from the accordion
    await w.get('[data-testid="assigned-resolved"]').trigger('click');
    await btn().trigger('click');
    await until(() => w.get('[data-testid="tab-count-assigned"]').text() === '2');
    expect(
      w.get(`[data-comment="${c.id}"] [data-testid="comment-resolve"]`).attributes('aria-pressed'),
    ).toBe('false');
  });

  it('без прав (не автор, не исполнитель, не админ) кнопка недоступна', async () => {
    await db.table('comments').put(comment('чужое', 1, { assigneeId: ids.bob, authorId: ids.bob }));
    w = await open();
    await until(() => !!tab());
    await tab()!.trigger('click');
    await flushPromises();
    expect(w.get('[data-testid="assigned-resolve"]').attributes('disabled')).toBeDefined();
  });
});
