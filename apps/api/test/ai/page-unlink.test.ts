// PLNRAPP-808: удалённая страница инструкции отвязывается от ИИ-действия, архив связь не рвёт
import { beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { db, useApp } from '../auth/harness.js';
import { key, world, type World } from '../sync/helpers.js';

useApp();

let w: World;
let P: string;

const pageOf = async (id: string) =>
  (await db.$client.query(`select page_id from ai_actions where id = $1`, [id])).rows[0]
    ?.page_id as string | null;

const action = async () => {
  const pageId = uuidv7();
  await w.admin.ok('docs.page.create', {
    id: pageId,
    spaceId: w.spaceId,
    projectId: P,
    rank: 'a0',
    title: 'Инструкция',
    body: { type: 'doc', content: [] },
  });
  const id = uuidv7();
  await w.admin.ok('ai.action.create', {
    id,
    projectId: P,
    key: `k${id.slice(-6)}`,
    name: 'Действие',
    pageId,
    runtime: 'llm',
    checks: [],
  });
  return { id, pageId };
};

beforeAll(async () => {
  w = await world(db);
  P = uuidv7();
  await w.admin.ok('project.create', {
    id: P,
    spaceId: w.spaceId,
    name: 'U',
    key: key(),
    rank: 'a0',
  });
});

describe('ai: страница инструкции и действие', () => {
  it('архив и восстановление связь не трогают', async () => {
    const a = await action();
    await w.admin.ok('docs.page.archive', { id: a.pageId });
    expect(await pageOf(a.id)).toBe(a.pageId);
    await w.admin.ok('docs.page.restore', { id: a.pageId });
    expect(await pageOf(a.id)).toBe(a.pageId);
  });

  it('удаление страницы обнуляет pageId действия', async () => {
    const a = await action();
    await w.admin.ok('docs.page.archive', { id: a.pageId });
    await w.admin.ok('docs.page.delete', { id: a.pageId });
    expect(await pageOf(a.id)).toBeNull();
  });
});
