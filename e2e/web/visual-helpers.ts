import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { BASE, Client, ranks, uuidv7 } from '../lib.js';
import { MODULES as COLLAB_MODULES, sendMsg, textDoc } from './collab-helpers.js';

/** «Now» in the browser: fixed, so that relative and absolute dates do not drift by days. */
export const NOW = '2026-03-10T10:10:00.000Z';
const BASE_TS = Date.parse('2026-03-10T10:00:00.000Z');
const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g;

export interface Data {
  spaceId: string;
  alice: Client;
  offset: number;
  projectKey: string;
  projectId: string;
  taskKey: string;
  chatId: string;
  docId: string;
}

const mentionDoc = (id: string, label: string, text: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id, label } },
        { type: 'text', text: ` ${text}` },
      ],
    },
  ],
});
// fixed ids: the order of the 'My hours' rows depends on the record ids
const entry = (n: number) => `00000000-0000-7000-8000-00000000000${n}`;
const SPACE_NAME = 'Дизайн-ревью';

/** A fresh stack is needed (./dev.sh reset && ./dev.sh seed): key DSG is unique; a repeat on the same stack takes data from the cache.
 * Server timestamps (ctx.now) cannot be set — we shift them to BASE_TS in the sync responses (see shiftTime). */
export async function buildData(): Promise<Data> {
  const admin = await Client.login('admin');
  // Playwright restarts the worker after a test fails — we take data from the cache, if the space still exists
  const cache = join(tmpdir(), `planar-visual-${new URL(BASE).port}.json`);
  try {
    const c = JSON.parse(readFileSync(cache, 'utf8')) as Data & { spaceId: string };
    if ((await admin.bootstrap()).data.spaces?.some((s) => s.id === c.spaceId))
      return { ...c, alice: await Client.login('alice') };
  } catch {
    /* no cache — create it */
  }

  const [alice, bob] = await Promise.all([Client.login('alice'), Client.login('bob')]);
  const offset = Date.now() - BASE_TS;
  const real = (iso: string) => new Date(Date.parse(iso) + offset).toISOString();
  const b0 = (await admin.bootstrap()).data;
  const cur = (b0.settings?.find((s) => s.id === 'enabled_modules')?.value as string[]) ?? [];
  const mods = [...new Set([...cur, ...COLLAB_MODULES, 'time'])];
  if (mods.length !== cur.length)
    await admin.pushOk([admin.mut('settings.set', { id: 'enabled_modules', value: mods })]);

  const spaceId = uuidv7();
  const projectId = uuidv7();
  const statusIds = Array.from({ length: 5 }, () => uuidv7());
  const [rs, rp, ...rt] = ranks(12);
  const labelIds = ['Бэкенд', 'Дизайн', 'Срочно'].map(() => uuidv7());
  const colors = ['#3b82f6', '#a855f7', '#ef4444'];
  const T = Array.from({ length: 6 }, () => uuidv7());
  const sub = [uuidv7(), uuidv7(), uuidv7()];
  await admin.pushOk([
    admin.mut('space.create', {
      id: spaceId,
      name: SPACE_NAME,
      rank: rs,
      memberId: uuidv7(),
      statusIds,
      statusNames: {
        backlog: 'Бэклог',
        todo: 'К работе',
        in_progress: 'В работе',
        done: 'Готово',
        cancelled: 'Отменено',
      },
    }),
    admin.mut('member.add', { id: uuidv7(), spaceId, userId: alice.userId, role: 'member' }),
    admin.mut('member.add', { id: uuidv7(), spaceId, userId: bob.userId, role: 'member' }),
    admin.mut('project.create', {
      id: projectId,
      spaceId,
      name: 'Мобильное приложение',
      key: 'DSG',
      rank: rp,
    }),
    ...labelIds.map((id, i) =>
      admin.mut('label.create', {
        id,
        spaceId,
        name: ['Бэкенд', 'Дизайн', 'Срочно'][i],
        color: colors[i],
      }),
    ),
    ...(
      [
        ['Подготовить макеты экрана входа', 0, 3, '2026-03-12'],
        ['Согласовать палитру тёмной темы', 1, 2, '2026-03-10'],
        ['Исправить обрезку заголовка в карточке', 1, 4, '2026-03-08'],
        ['Проверить контраст текста на доске', 2, 1, '2026-03-20'],
        ['Описать правила плотности интерфейса', 3, 2, null],
        ['Выпустить релиз 1.4', 4, 0, null],
      ] as const
    ).map(([title, st, priority, dueDate], i) =>
      admin.mut('task.create', {
        id: T[i],
        projectId,
        statusId: statusIds[st],
        title,
        rank: rt[i],
        priority,
        dueDate,
        ...(i < 4 && { assignees: [{ id: uuidv7(), userId: i % 2 ? bob.userId : alice.userId }] }),
        ...(i < 3 && { labels: [{ id: uuidv7(), labelId: labelIds[i]! }] }),
      }),
    ),
    ...['Нарисовать состояния полей', 'Проверить на 390 px', 'Передать в разработку'].map(
      (title, i) =>
        admin.mut('task.create', {
          id: sub[i],
          projectId,
          statusId: statusIds[i === 0 ? 2 : 0],
          title,
          rank: rt[6 + i],
          parentId: T[0],
        }),
    ),
    admin.mut('task.assign', { id: uuidv7(), taskId: T[0]!, userId: bob.userId }),
    admin.mut('task.addLabel', { id: uuidv7(), taskId: T[0]!, labelId: labelIds[1]! }),
    admin.mut('comment.create', {
      id: uuidv7(),
      taskId: T[0]!,
      body: mentionDoc(alice.userId, 'Alice', 'Нужен вариант для узких экранов.'),
    }),
    admin.mut('comment.create', {
      id: uuidv7(),
      taskId: T[1]!,
      body: textDoc('Проверьте контраст.'),
    }),
  ]);
  await bob.pushOk([
    bob.mut('comment.create', {
      id: uuidv7(),
      taskId: T[0]!,
      body: textDoc('Макеты готовы к ревью.'),
    }),
    bob.mut('time.log', {
      id: entry(1),
      taskId: T[0]!,
      startedAt: real('2026-03-09T09:00:00.000Z'),
      durationSec: 5400,
      note: 'Макеты',
    }),
  ]);
  await alice.pushOk([
    alice.mut('time.log', {
      id: entry(2),
      taskId: T[0]!,
      startedAt: real('2026-03-09T09:00:00.000Z'),
      durationSec: 7200,
      note: 'Макеты входа',
    }),
    alice.mut('time.log', {
      id: entry(3),
      taskId: T[1]!,
      startedAt: real('2026-03-10T08:00:00.000Z'),
      durationSec: 3600,
      note: 'Палитра',
    }),
    alice.mut('time.log', {
      id: entry(4),
      taskId: T[3]!,
      startedAt: real('2026-03-11T08:00:00.000Z'),
      durationSec: 1800,
      note: '',
    }),
  ]);

  const chatId = uuidv7();
  await admin.pushOk([admin.mut('chat.channel.create', { id: chatId, spaceId, name: 'общий' })]);
  await sendMsg(admin, chatId, 'Доброе утро! Макеты экранов выложены.');
  await sendMsg(bob, chatId, 'Посмотрю после обеда.');
  await sendMsg(alice, chatId, 'Нашла обрезку заголовка на узком экране.');

  const docId = uuidv7();
  await admin.pushOk([
    admin.mut('docs.page.create', {
      id: docId,
      spaceId,
      rank: ranks(1)[0],
      title: 'Правила интерфейса',
      body: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Плотность и отступы' }],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Базовая единица — 4 px. Строка списка не выше 32 px, на телефоне не ниже 44 px.',
              },
            ],
          },
          {
            type: 'bulletList',
            content: ['Заголовок экрана', 'Таблицы и списки', 'Формы'].map((t) => ({
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
            })),
          },
        ],
      },
    }),
  ]);
  const key = 'DSG';
  const t1 = (await admin.bootstrap()).data.tasks!.find((t) => t.id === T[0])!;
  const out = {
    spaceId,
    alice,
    offset,
    projectKey: key,
    projectId,
    taskKey: `${key}-${t1.number}`,
    chatId,
    docId,
  };
  writeFileSync(cache, JSON.stringify({ ...out, alice: undefined }));
  return out;
}

/** Shifts all ISO timestamps in /sync and /api responses to BASE_TS: server «now» → NOW − 10 min. */
export async function shiftTime(page: Page, offset: number) {
  await page.route(/\/(sync|api)\//, async (route) => {
    const r = await route.fetch();
    const ct = r.headers()['content-type'] ?? '';
    if (!ct.includes('json')) return route.fulfill({ response: r });
    const body = (await r.text()).replace(ISO, (m) =>
      new Date(Date.parse(m) - offset).toISOString(),
    );
    await route.fulfill({ response: r, body });
  });
}
