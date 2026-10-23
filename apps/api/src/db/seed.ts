// Сид dev-данных: tsx --conditions=source src/db/seed.ts [--tasks N] [--bench]
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import argon2 from 'argon2';
import { desc, eq, sql } from 'drizzle-orm';
import { generateNKeysBetween } from 'fractional-indexing';
import pg from 'pg';
import { createDb, migrate, type Db } from './index.js';
import * as s from './schema.js';

const BATCH = 1000;

/** uuidv7: 48 бит времени (мс) + случайные биты. */
function uuidv7(): string {
  const b = randomBytes(16);
  b.writeUIntBE(Date.now(), 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function insertBatched<T extends Parameters<Db['insert']>[0]>(
  db: Db,
  table: T,
  rows: Record<string, unknown>[],
) {
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.insert(table).values(rows.slice(i, i + BATCH) as never);
  }
}

const STATUSES = [
  ['Backlog', 'backlog', '#94a3b8'],
  ['Todo', 'todo', '#3b82f6'],
  ['In progress', 'in_progress', '#f59e0b'],
  ['Done', 'done', '#22c55e'],
  ['Cancelled', 'cancelled', '#ef4444'],
] as const;
const LABELS = [
  ['bug', '#ef4444'],
  ['feature', '#3b82f6'],
  ['docs', '#a855f7'],
  ['chore', '#64748b'],
] as const;

/** Базовые данные; ничего не делает, если пользователь admin уже есть. */
async function seedBase(db: Db) {
  const [exists] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.login, 'admin'));
  if (exists) return;
  const users = await Promise.all(
    (
      [
        ['admin', 'owner'],
        ['alice', 'member'],
        ['bob', 'member'],
      ] as const
    ).map(async ([login, role]) => ({
      id: uuidv7(),
      login,
      name: login[0]!.toUpperCase() + login.slice(1),
      role,
      passwordHash: await argon2.hash(login, { type: argon2.argon2id }),
    })),
  );
  await db.insert(s.users).values(users);
  const admin = users[0]!.id;
  const [r1, r2] = generateNKeysBetween(null, null, 2) as [string, string];
  const spaces = [
    { id: uuidv7(), name: 'Разработка', rank: r1, createdBy: admin },
    { id: uuidv7(), name: 'Маркетинг', rank: r2, createdBy: admin },
  ];
  await db.insert(s.spaces).values(spaces);
  await db.insert(s.spaceMembers).values(
    spaces.flatMap((sp) =>
      users.map((u) => ({
        spaceId: sp.id,
        userId: u.id,
        role: u.login === 'admin' ? 'admin' : 'member',
      })),
    ),
  );
  const ranks = generateNKeysBetween(null, null, STATUSES.length);
  await db.insert(s.statuses).values(
    spaces.flatMap((sp) =>
      STATUSES.map(([name, category, color], i) => ({
        spaceId: sp.id,
        name,
        category,
        color,
        rank: ranks[i]!,
      })),
    ),
  );
  await db
    .insert(s.labels)
    .values(
      spaces.flatMap((sp) => LABELS.map(([name, color]) => ({ spaceId: sp.id, name, color }))),
    );
  const pr = generateNKeysBetween(null, null, 2) as [string, string];
  await db.insert(s.projects).values([
    { spaceId: spaces[0]!.id, name: 'Planar', key: 'PLN', rank: pr[0] },
    { spaceId: spaces[0]!.id, name: 'Operations', key: 'OPS', rank: pr[1] },
    { spaceId: spaces[1]!.id, name: 'Website', key: 'WEB', rank: pr[0] },
  ]);
}

/** Добавляет n задач по всем проектам; пишет напрямую в таблицы, без changes. */
async function seedTasks(db: Db, n: number) {
  if (n <= 0) return;
  const [admin] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.login, 'admin'));
  const members = await db.select().from(s.spaceMembers);
  const statuses = await db.select().from(s.statuses);
  const labels = await db.select().from(s.labels);
  const projects = await db.select().from(s.projects);
  const perProject = projects.map(
    (_, pi) => Math.floor(n / projects.length) + (pi < n % projects.length ? 1 : 0),
  );

  const tasks: Record<string, unknown>[] = [];
  const assignees: Record<string, unknown>[] = [];
  const taskLabels: Record<string, unknown>[] = [];
  for (const [pi, p] of projects.entries()) {
    const count = perProject[pi]!;
    const [last] = await db
      .select({ rank: s.tasks.rank })
      .from(s.tasks)
      .where(eq(s.tasks.projectId, p.id))
      .orderBy(desc(s.tasks.rank))
      .limit(1);
    const ranks = generateNKeysBetween(last?.rank ?? null, null, count);
    const st = statuses.filter((x) => x.spaceId === p.spaceId);
    const us = members.filter((x) => x.spaceId === p.spaceId);
    const lb = labels.filter((x) => x.spaceId === p.spaceId);
    if (!st.length || !us.length) continue; // без статусов/участников задачу не создать
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = uuidv7();
      const status = st[i % st.length]!;
      const done = status.category === 'done' || status.category === 'cancelled';
      ids.push(id);
      tasks.push({
        id,
        spaceId: p.spaceId,
        projectId: p.id,
        number: p.taskCounter + i + 1,
        parentId: i % 10 === 9 ? ids[i - 5] : null,
        statusId: status.id,
        title: `${p.key} задача ${p.taskCounter + i + 1}`,
        priority: i % 5,
        rank: ranks[i]!,
        createdBy: admin!.id,
        completedAt: done ? new Date().toISOString() : null,
      });
      assignees.push({ spaceId: p.spaceId, taskId: id, userId: us[i % us.length]!.userId });
      if (i % 3 === 0 && lb.length)
        taskLabels.push({ spaceId: p.spaceId, taskId: id, labelId: lb[i % lb.length]!.id });
    }
    await db
      .update(s.projects)
      .set({ taskCounter: sql`${s.projects.taskCounter} + ${count}` })
      .where(eq(s.projects.id, p.id));
  }
  // родители раньше детей: parentId указывает на более раннюю задачу того же проекта
  await insertBatched(
    db,
    s.tasks,
    tasks.sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0)),
  );
  await insertBatched(db, s.taskAssignees, assignees);
  await insertBatched(db, s.taskLabels, taskLabels);
}

export async function seed(db: Db, tasks = 0) {
  await seedBase(db);
  await seedTasks(db, tasks);
}

async function main() {
  const argv = process.argv.slice(2);
  const bench = argv.includes('--bench');
  const ti = argv.indexOf('--tasks');
  const tasks = ti >= 0 ? Number(argv[ti + 1]) : 0;
  if (!Number.isInteger(tasks) || tasks < 0) throw new Error('--tasks N: целое ≥ 0');

  if (!bench) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL не задан');
    const db = createDb(url);
    try {
      await migrate(db);
      await seed(db, tasks);
    } finally {
      await db.$client.end();
    }
    return;
  }

  const adminUrl = new URL(
    process.env.TESTDB_URL ?? 'postgres://postgres:postgres@localhost:55432/postgres',
  );
  const name = `planar_t_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`create database ${name}`);
  adminUrl.pathname = `/${name}`;
  const db = createDb(adminUrl.toString());
  try {
    await migrate(db);
    await seedBase(db);
    const t0 = performance.now();
    await seedTasks(db, tasks);
    console.log(`seed_ms=${Math.round(performance.now() - t0)} tasks=${tasks}`);
  } finally {
    await db.$client.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
