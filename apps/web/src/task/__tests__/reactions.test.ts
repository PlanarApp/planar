import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { db, eventually, ids, open, queued, setup, until } from './h';

let w: VueWrapper;
let t: Awaited<ReturnType<typeof setup>>;
let cid: string;
beforeEach(async () => {
  t = await setup();
  cid = crypto.randomUUID();
  const now = t.createdAt;
  await db.table('comments').put({
    id: cid,
    spaceId: ids.space,
    taskId: t.id,
    authorId: ids.bob,
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    },
    mentions: [],
    editedAt: null,
    createdAt: now,
    updatedAt: now,
  });
});
afterEach(() => w?.unmount());

const react = (userId: string, emoji = '👍') =>
  db.table('commentReactions').put({
    id: crypto.randomUUID(),
    spaceId: ids.space,
    commentId: cid,
    userId,
    emoji,
    createdAt: t.createdAt,
  });
const chips = () => w.findAll('[data-testid="reaction"]');

describe('task:reactions', () => {
  it('поставить через пикер: reaction.toggle и своя чип выделена', async () => {
    w = await open();
    await until(() => w.find('[data-testid="reaction-add"]').exists());
    await w.find('[data-testid="reaction-add"]').trigger('click');
    await until(() => document.querySelector('[data-testid="reaction-pick"]') !== null);
    expect(document.querySelectorAll('[data-testid="reaction-pick"]')).toHaveLength(8);
    (document.querySelector('[data-testid="reaction-pick"]') as HTMLElement).click();
    await eventually(async () => (await db.table('commentReactions').count()) === 1);
    await until(() => chips().length === 1);
    expect(chips()[0].attributes('aria-pressed')).toBe('true');
    expect(chips()[0].text()).toContain('1');
  });
  it('снять повторным кликом', async () => {
    await react(ids.ann);
    w = await open();
    await until(() => chips().length === 1);
    await chips()[0].trigger('click');
    await eventually(async () => (await db.table('commentReactions').count()) === 0);
    await until(() => chips().length === 0);
  });
  it('счётчик по разным пользователям', async () => {
    await react(ids.ann);
    await react(ids.bob);
    w = await open();
    await until(() => chips().length === 1);
    expect(chips()[0].text()).toContain('2');
  });
  it('чужая не снимается моим кликом', async () => {
    await react(ids.bob);
    w = await open();
    await until(() => chips().length === 1);
    expect(chips()[0].attributes('aria-pressed')).toBe('false');
    await chips()[0].trigger('click');
    await eventually(async () => (await db.table('commentReactions').count()) === 2);
    expect(await queued('reaction.toggle')).toHaveLength(1);
    expect((await db.table('commentReactions').toArray()).some((r) => r.userId === ids.bob)).toBe(
      true,
    );
  });
});
