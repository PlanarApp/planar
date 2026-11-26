// An icon `file:<sha>` opens the file to everyone who sees the space/project: only an own upload or one already used in the space.
import { afterAll, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { fileUploads, files } from '../../src/db/schema.js';
import { newDb, world } from '../sync/helpers.js';

const db = newDb();
afterAll(() => db.$client.end());

it('иконка file:<sha>: чужой файл — forbidden; свой или уже использованный в пространстве — можно', async () => {
  const w = await world(db);
  const sha = 'a'.repeat(64);
  await db
    .insert(files)
    .values({ sha256: sha, size: 1, mime: 'image/png', createdBy: w.admin.userId });
  await db.insert(fileUploads).values({ sha256: sha, userId: w.admin.userId });
  const project = (icon: string) => ({
    id: uuidv7(),
    spaceId: w.spaceId,
    name: 'p',
    key: 'I' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    rank: 'a',
    icon,
  });
  const icon = `file:${sha}`;
  expect(await w.member.push('project.create', project(icon))).toMatchObject({
    ok: false,
    code: 'forbidden',
  });
  await w.admin.ok('project.create', project(icon));
  // already an icon in this space (a copy of a project): allowed
  await w.member.ok('project.create', project(icon));
});
