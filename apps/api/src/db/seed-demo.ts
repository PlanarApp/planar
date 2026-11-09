// Demo seed (C-launch-demo v1): tsx --conditions=source src/db/seed-demo.ts [--reset]; in the image: node dist/db/seed-demo.js [--reset]
// English, deterministic (ids and values are derived from fixed keys, dates are offsets from `now`).
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { generateNKeysBetween } from 'fractional-indexing';
import { dashboardsBoards, dashboardsWidgets } from '@planar/module-dashboards/api/schema';
import { docsPages, docsTaskLinks } from '@planar/module-docs/api/schema';
import {
  chatChannels,
  chatMembers,
  chatMessages,
  chatReactions,
  chatReads,
} from '@planar/module-chat/api/schema';
import {
  goalsGoals,
  goalsKeyResults,
  goalsMilestones,
  goalsMilestoneTasks,
} from '@planar/module-goals/api/schema';
import { automationsRules } from '@planar/module-automations/api/schema';
import { formsForms } from '@planar/module-forms/api/schema';
import { recurringRules } from '@planar/module-recurring/api/schema';
import { templatesTemplates } from '@planar/module-templates/api/schema';
import { workloadCapacities } from '@planar/module-workload/api/schema';
import { sprintsCycles, sprintsSettings } from '@planar/module-sprints/api/schema';
import { timeEntries, timeEstimates } from '@planar/module-time/api/schema';
import { DATA_MODULE_IDS, extractMentions, textToDoc } from '@planar/shared';
import { createDb, migrate, type Db } from './index.js';
import { filePath } from '../files/store.js';
import * as s from './schema.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Deterministic uuid from a key. */
const uid = (key: string) => {
  const h = createHash('sha1').update(`planar-demo:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
/** Fixed-seed PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USERS = [
  ['maya', 'Maya Chen', 'owner', '#6366f1'],
  ['demo', 'Demo User', 'member', '#0ea5e9'],
  ['liam', 'Liam Walker', 'member', '#10b981'],
  ['sofia', 'Sofia Rossi', 'member', '#f43f5e'],
  ['noah', 'Noah Kim', 'member', '#f59e0b'],
  ['ava', 'Ava Patel', 'member', '#8b5cf6'],
  ['omar', 'Omar Haddad', 'member', '#14b8a6'],
  ['emma', 'Emma Larsen', 'member', '#ec4899'],
  ['jack', 'Jack Turner', 'member', '#64748b'],
  ['nina', 'Nina Volkova', 'guest', '#84cc16'],
] as const;

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
  ['improvement', '#22c55e'],
  ['docs', '#a855f7'],
  ['research', '#f59e0b'],
] as const;

// Workspace = root space (settings root_space, workspace): without it group tabs have no scope
const WORKSPACE = { name: 'Brightwave', color: '#6366f1', icon: '🌊' };
/** `space` of DOCS / CHANNELS at the Workspace level */
const ROOT = -1;
// node icons are emoji (NodeIcon)
const SPACES = [
  ['Product', 'Roadmap, discovery and customer feedback', '#6366f1', '🧭'],
  ['Engineering', 'Platform and mobile development', '#0ea5e9', '⚙️'],
  ['Marketing', 'Campaigns, content and launch', '#ec4899', '📣'],
  ['Design', 'Design system and product design', '#8b5cf6', '🎨'],
  ['Support', 'Help center and customer success', '#10b981', '🛟'],
] as const;

// task: [title, status 0-4, priority 0-4, due offset in days | null, assignees, labels, parent index | undefined]
type T = [string, number, number, number | null, string, string, number?];
const PROJECTS: { space: number; name: string; key: string; icon: string; tasks: T[] }[] = [
  {
    space: 0,
    name: 'Roadmap',
    key: 'RDM',
    icon: '🗺️',
    tasks: [
      ['Define Q4 product goals', 3, 3, -12, 'maya', 'research'],
      ['Customer interview synthesis', 3, 2, -6, 'demo,sofia', 'research'],
      ['Public beta announcement plan', 2, 4, 4, 'maya,demo', 'feature'],
      ['Pricing page experiments', 2, 3, 9, 'sofia', 'improvement'],
      ['Onboarding checklist for new workspaces', 1, 3, 12, 'demo', 'feature'],
      ['Reduce time-to-first-task', 1, 2, 18, 'demo,liam', 'improvement'],
      ['Import from CSV: edge cases', 2, 3, -2, 'noah', 'bug'],
      ['Usage analytics dashboard spec', 1, 2, 25, 'sofia', 'docs'],
      ['Collect feature requests from forum', 0, 1, null, 'demo', 'research'],
      ['Dark mode polish', 0, 1, 38, 'ava', 'improvement'],
      ['Draft customer survey', 1, 2, 16, 'sofia', 'research', 8],
      ['Define survey audience', 3, 1, -3, 'demo', 'research', 10],
    ],
  },
  {
    space: 1,
    name: 'Platform',
    key: 'PLT',
    icon: '🧱',
    tasks: [
      ['Migrate sessions to Redis-free store', 3, 3, -18, 'liam', 'improvement'],
      ['Rate limiting for public API', 3, 3, -16, 'noah', 'feature'],
      ['Fix webhook retry backoff', 3, 2, -15, 'omar', 'bug'],
      ['Add API v2 pagination', 2, 4, 3, 'liam,demo', 'feature'],
      ['Search index rebuild is slow', 2, 4, -1, 'noah', 'bug'],
      ['Audit log export', 2, 3, 6, 'omar', 'feature'],
      ['Write API v2 migration guide', 1, 2, 8, 'demo', 'docs'],
      ['Upgrade Postgres to 17', 1, 3, 20, 'liam', 'improvement'],
      ['Flaky e2e test on Safari', 1, 2, 5, 'jack', 'bug'],
      ['Background job dashboard', 1, 2, 11, 'omar', 'feature'],
      ['Reduce Docker image size', 0, 1, null, 'jack', 'improvement'],
      ['Support SAML SSO', 0, 3, 40, 'noah', 'feature'],
      ['Cursor tokens for pagination', 2, 3, 4, 'liam', 'feature', 3],
      ['Update OpenAPI examples', 1, 1, 7, 'demo', 'docs', 3],
    ],
  },
  {
    space: 1,
    name: 'Mobile',
    key: 'MOB',
    icon: '📱',
    tasks: [
      ['Offline mode for task list', 2, 4, 10, 'ava,jack', 'feature'],
      ['Push notification permissions flow', 1, 3, 14, 'ava', 'feature'],
      ['Crash on cold start (Android 12)', 2, 4, -4, 'jack', 'bug'],
      ['Biometric unlock', 0, 2, 35, 'ava', 'feature'],
      ['App store screenshots', 1, 2, 17, 'emma', 'docs'],
      ['Swipe actions on tasks', 3, 2, -9, 'jack', 'improvement'],
      ['Tablet layout', 0, 1, null, 'ava', 'improvement'],
      ['Share sheet integration', 1, 2, 24, 'jack', 'feature'],
    ],
  },
  {
    space: 2,
    name: 'Launch',
    key: 'MKT',
    icon: '🚀',
    tasks: [
      ['Launch landing page copy', 2, 4, 3, 'emma,demo', 'docs'],
      ['Press kit and logos', 2, 3, 8, 'emma', 'docs'],
      ['Product Hunt launch plan', 1, 4, 20, 'sofia,emma', 'feature'],
      ['Launch webinar outline', 1, 3, 26, 'demo', 'research'],
      ['Email sequence for beta users', 2, 3, -3, 'emma', 'feature'],
      ['Partner outreach list', 3, 2, -11, 'sofia', 'research'],
      ['Case study: Northwind Logistics', 1, 2, 30, 'emma', 'docs'],
      ['Social media calendar', 3, 2, -7, 'emma', 'docs'],
      ['Blog: how we plan sprints', 0, 1, 42, 'demo', 'docs'],
      ['Newsletter signup A/B test', 1, 2, 13, 'sofia', 'improvement'],
    ],
  },
  {
    space: 3,
    name: 'Design System',
    key: 'DSG',
    icon: '🧩',
    tasks: [
      ['Audit button variants', 3, 2, -14, 'ava', 'research'],
      ['Spacing and typography tokens', 3, 3, -8, 'ava,nina', 'feature'],
      ['Empty states illustrations', 2, 3, 7, 'nina', 'feature'],
      ['Accessible color contrast pass', 2, 4, 2, 'ava', 'improvement'],
      ['Icon set cleanup', 1, 2, 15, 'nina', 'improvement'],
      ['Board card redesign', 1, 3, 21, 'ava,demo', 'feature'],
      ['Mobile navigation patterns', 0, 2, null, 'nina', 'research'],
      ['Document component usage rules', 1, 2, 28, 'ava', 'docs'],
    ],
  },
  {
    space: 4,
    name: 'Help Center',
    key: 'SUP',
    icon: '💬',
    tasks: [
      ['Article: connecting GitLab', 3, 2, -10, 'jack', 'docs'],
      ['Article: setting up recurring tasks', 2, 2, 5, 'demo', 'docs'],
      ['Refund request from Acme Corp', 2, 4, -1, 'omar', 'bug'],
      ['Triage backlog of old tickets', 1, 3, 4, 'jack,omar', 'improvement'],
      ['Chatbot answers review', 1, 2, 19, 'demo', 'research'],
      ['Weekly support triage', 1, 3, 2, 'omar', 'improvement'],
      ['Customer says exports are empty', 2, 4, -2, 'jack', 'bug'],
      ['Translate top 10 articles', 0, 1, 45, 'nina', 'docs'],
      ['Update status page template', 3, 1, -5, 'omar', 'docs'],
    ],
  },
];

const COMMENTS: [string, number, string, string][] = [
  // [project key, task index, author, text]
  ['RDM', 2, 'maya', 'Draft is ready. @demo can you review the timeline section before Friday?'],
  ['RDM', 2, 'demo', 'On it. I will also check the dates against the @emma launch calendar.'],
  [
    'RDM',
    6,
    'noah',
    'Reproduced with a 50k row file. Quoted fields with line breaks are the culprit.',
  ],
  ['PLT', 3, 'liam', 'Cursor format is final. @demo please update the docs once this lands.'],
  ['PLT', 3, 'demo', 'Will do. Adding a migration guide section for it.'],
  [
    'PLT',
    4,
    'noah',
    'Rebuild takes 11 min on staging. Profiling shows the tokenizer is the hot spot, @liam.',
  ],
  ['PLT', 4, 'liam', 'Let us batch updates in chunks of 500 and see.'],
  ['MOB', 2, 'jack', 'Only on Pixel 6 with Android 12. @ava have you seen this on iOS?'],
  ['MOB', 0, 'ava', 'Sync conflict strategy: last write wins per field. Thoughts, @maya?'],
  ['MKT', 0, 'emma', 'Headline v2 tests better in the quick poll. @demo please take a look.'],
  ['MKT', 4, 'sofia', 'Sequence is 5 emails over 3 weeks. Subject lines are in the doc.'],
  ['DSG', 3, 'ava', 'Three tokens fail AA on dark backgrounds. List is attached to the doc.'],
  ['SUP', 2, 'omar', 'Customer is on the annual plan. @maya do we approve a prorated refund?'],
  ['SUP', 2, 'maya', 'Yes, prorated is fine. Please confirm with finance.'],
  [
    'SUP',
    6,
    'jack',
    'Looks like exports fail when a custom field name contains a slash. Filing a fix.',
  ],
];

const CHECKLISTS: [string, number, [string, boolean][]][] = [
  [
    'RDM',
    2,
    [
      ['Write announcement post', true],
      ['Prepare in-app banner', true],
      ['Notify beta users', false],
      ['Schedule social posts', false],
    ],
  ],
  [
    'PLT',
    3,
    [
      ['Design cursor format', true],
      ['Implement list endpoints', true],
      ['Update OpenAPI spec', false],
      ['Add contract tests', false],
    ],
  ],
  [
    'MOB',
    0,
    [
      ['Local database schema', true],
      ['Queue for pending changes', false],
      ['Conflict resolution UI', false],
    ],
  ],
  [
    'MKT',
    0,
    [
      ['Hero section', true],
      ['Feature grid', false],
      ['Pricing teaser', false],
      ['Legal review', false],
    ],
  ],
  [
    'DSG',
    3,
    [
      ['Audit light theme', true],
      ['Audit dark theme', false],
      ['Fix failing tokens', false],
    ],
  ],
  [
    'SUP',
    1,
    [
      ['Outline article', true],
      ['Record short video', false],
      ['Publish to help center', false],
    ],
  ],
];

// space ROOT — Workspace; project — project key (the page lives in that project's space)
const DOCS: {
  space: number;
  project?: string;
  title: string;
  icon: string;
  paras: string[];
  parent?: number;
}[] = [
  {
    space: 0,
    title: 'Product vision',
    icon: '🧭',
    paras: [
      'Brightwave helps small teams plan, track and ship work in one place.',
      'Our focus this year: faster onboarding, reliable sprints and a calm interface.',
    ],
  },
  {
    space: 0,
    title: 'Q4 goals',
    icon: '🎯',
    parent: 0,
    paras: [
      'Reach 1,000 active teams.',
      'Launch the public beta and collect 100 pieces of feedback.',
    ],
  },
  {
    space: 1,
    title: 'Architecture overview',
    icon: '🏗️',
    paras: [
      'The API is a NestJS service on Postgres. Clients sync through a change log.',
      'Modules extend the core with their own tables and mutators.',
    ],
  },
  {
    space: 1,
    title: 'On-call runbook',
    icon: '🚨',
    parent: 2,
    paras: [
      '1. Check the health endpoint.',
      '2. Look at slow queries in the last hour.',
      '3. Page the platform lead if errors stay above 2% for 10 minutes.',
    ],
  },
  {
    space: 2,
    title: 'Launch messaging',
    icon: '📣',
    paras: ['Tagline: Plan less, ship more.', 'Audience: product teams of 5 to 50 people.'],
  },
  {
    space: 3,
    title: 'Design principles',
    icon: '🎨',
    paras: ['Calm, dense, keyboard friendly.', 'Every screen has a clear primary action.'],
  },
  {
    space: 4,
    title: 'Support playbook',
    icon: '🛟',
    paras: [
      'First response within 4 working hours.',
      'Escalate refunds above 500 USD to the owner.',
    ],
  },
  {
    space: ROOT,
    title: 'Welcome to Brightwave',
    icon: '👋',
    paras: [
      'Brightwave is a 10-person product team. Everything we plan, discuss and ship lives here.',
      'Start with My work: your tasks for today, mentions and things waiting for you.',
      'Each space has its own projects, docs and chats. Company-wide pages and #general live at the top level.',
    ],
  },
  {
    space: ROOT,
    title: 'Team handbook',
    icon: '📘',
    parent: 7,
    paras: [
      'We plan in two-week sprints and demo every other Thursday.',
      'Ask in chat first, write it down in docs second, track it as a task third.',
      'Core hours: 11:00 to 16:00 in your time zone.',
    ],
  },
  {
    space: 1,
    project: 'PLT',
    title: 'API v2 spec',
    icon: '📐',
    paras: [
      'List endpoints return cursor tokens instead of page numbers.',
      'Every response carries a request id for support.',
      'v1 stays available for 12 months after the v2 release.',
    ],
  },
  {
    space: 2,
    project: 'MKT',
    title: 'Launch checklist',
    icon: '✅',
    paras: [
      'T-14: landing page and press kit ready.',
      'T-7: email sequence scheduled, partners briefed.',
      'T-0: Product Hunt post at 00:01 PT, team on chat all day.',
    ],
  },
];

const CHANNELS: {
  space: number;
  project?: string;
  name: string;
  topic: string;
  msgs: [string, string, number?][];
}[] = [
  {
    space: ROOT,
    name: 'general',
    topic: 'Company news and quick questions',
    msgs: [
      ['maya', 'Good morning team! Beta announcement is scheduled for next week.'],
      ['sofia', 'Survey results are in. 82% said onboarding felt easy.'],
      ['demo', 'Nice work @sofia! I will add the numbers to the Q4 goals page.'],
      ['maya', 'Reminder: planning on Thursday at 10:00.'],
    ],
  },
  {
    space: 1,
    name: 'dev',
    topic: 'Engineering chatter',
    msgs: [
      ['liam', 'Pagination PR is up for review. @noah @omar'],
      ['noah', 'Looking now. Left a couple of questions on the cursor encoding.'],
      ['omar', 'Staging deploy is green. Search rebuild still slow though.'],
      ['jack', 'Safari e2e flake is back. I will bisect today.'],
      ['liam', 'Thanks all. Merging after CI.'],
    ],
  },
  {
    space: 2,
    name: 'launch',
    topic: 'Everything about the launch',
    msgs: [
      ['emma', 'Landing page draft is in the docs. Feedback welcome!'],
      ['sofia', 'Product Hunt slot is booked for the 3rd Tuesday.'],
      ['demo', 'Great. @emma I can write the FAQ section.'],
    ],
  },
  {
    space: 4,
    name: 'help',
    topic: 'Support escalations',
    msgs: [
      ['omar', 'Acme Corp asked for a refund, see SUP tasks.'],
      ['maya', 'Approved. Please follow up with finance.'],
    ],
  },
  {
    space: 0,
    name: 'product',
    topic: 'Discovery, feedback and roadmap',
    msgs: [
      ['sofia', 'Top request this week: recurring tasks with custom intervals.'],
      ['maya', 'Good signal. Let us add it to the roadmap review.'],
      ['demo', 'I will collect the forum threads into one task.'],
    ],
  },
  {
    space: 1,
    project: 'PLT',
    name: 'api-v2',
    topic: 'API v2 rollout',
    msgs: [
      ['liam', 'Cursor pagination is merged behind a flag.'],
      ['demo', 'Migration guide draft is in the project docs. @liam please review.'],
      ['noah', 'Rate limits for v2 are the same as v1 for now.'],
    ],
  },
  {
    space: 1,
    project: 'MOB',
    name: 'mobile',
    topic: 'Mobile releases',
    msgs: [
      ['jack', 'Android crash fix is in beta. Crash-free sessions back to 99.6%.'],
      ['ava', 'Offline mode demo on Thursday, bring your phones!'],
    ],
  },
];

const cap = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export async function seedDemo(db: Db, now: Date = new Date()): Promise<void> {
  await db.transaction((tx) => insertAll(tx, now));
}

/** Empties all application tables (except the migration journal in schema drizzle) and seeds again, in one transaction. */
export async function resetDemo(db: Db, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.execute(
      sql`select quote_ident(tablename) as t from pg_tables where schemaname = 'public'`,
    );
    if (rows.length)
      await tx.execute(
        sql.raw(`truncate ${rows.map((r) => `public.${r.t}`).join(', ')} restart identity cascade`),
      );
    await insertAll(tx, now);
  });
}

async function insertAll(tx: Tx, now: Date) {
  const [{ n }] = (
    await tx.execute(sql`select count(*)::int as n from users where login <> 'automation'`)
  ).rows as { n: number }[];
  if (n > 0) throw new Error('demo seed: database is not empty');

  const rnd = prng(20240601);
  const MS = 86_400_000;
  const at = (days: number, hours = 9) =>
    new Date(now.getTime() + days * MS + hours * 3_600_000).toISOString();
  const day = (days: number) => new Date(now.getTime() + days * MS).toISOString().slice(0, 10);
  const ins = (table: Parameters<Db['insert']>[0], rows: unknown[]) =>
    rows.length ? tx.insert(table).values(rows as never) : Promise.resolve();

  // users with generated SVG avatars
  const svgOf = (name: string, color: string) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="${color}"/><text x="64" y="82" font-family="sans-serif" font-size="56" fill="#fff" text-anchor="middle">${name
        .split(' ')
        .map((w) => w[0])
        .join('')}</text></svg>`,
    );
  const uid_ = Object.fromEntries(USERS.map(([l]) => [l, uid(`user:${l}`)])) as Record<
    string,
    string
  >;
  const avatarSha = (name: string, color: string) =>
    createHash('sha256').update(svgOf(name, color)).digest('hex');
  await ins(s.users, [
    ...USERS.map(([login, name, role, color], i) => ({
      id: uid_[login]!,
      login,
      name,
      email: `${login}@brightwave.example`,
      role,
      avatarFile: avatarSha(name, color),
      passwordHash: '!',
      createdAt: at(-90 + i),
      updatedAt: at(-90 + i),
    })),
    {
      id: uid('user:automation'),
      login: 'automation',
      name: 'Automation',
      role: 'member',
      deactivatedAt: at(-90),
      passwordHash: '!',
      createdAt: at(-90),
      updatedAt: at(-90),
    },
  ]);
  const maya = uid_.maya!;
  await ins(
    s.files,
    USERS.map(([, name, , color]) => {
      const b = svgOf(name, color);
      return {
        sha256: avatarSha(name, color),
        size: b.length,
        mime: 'image/svg+xml',
        width: 128,
        height: 128,
        createdBy: maya,
        createdAt: at(-90),
      };
    }),
  );
  await ins(
    s.fileUploads,
    USERS.map(([, name, , color], i) => ({
      sha256: avatarSha(name, color),
      userId: uid_[USERS[i]![0]]!,
      createdAt: at(-90),
    })),
  );
  // the SVG bytes themselves (only where the file store is known)
  if (process.env.DATA_DIR) {
    for (const [, name, , color] of USERS) {
      const p = filePath(process.env.DATA_DIR, avatarSha(name, color));
      await mkdir(dirname(p), { recursive: true })
        .then(() => writeFile(p, svgOf(name, color)))
        .catch(() => {});
    }
  }

  // spaces, members, statuses, labels
  const spRanks = generateNKeysBetween(null, null, SPACES.length + 1);
  const spaceIds = SPACES.map((_, i) => uid(`space:${i}`));
  const rootId = uid('space:root');
  const sp = (i: number) => (i === ROOT ? rootId : spaceIds[i]!);
  await ins(s.spaces, [
    {
      id: rootId,
      name: WORKSPACE.name,
      rank: spRanks[0],
      createdBy: maya,
      createdAt: at(-90),
      updatedAt: at(-90),
    },
    ...SPACES.map(([name, description, color, icon], i) => ({
      id: spaceIds[i],
      name,
      description,
      color,
      icon,
      rank: spRanks[i + 1],
      createdBy: maya,
      createdAt: at(-90),
      updatedAt: at(-90),
    })),
  ]);
  await ins(s.settings, [
    { id: 'root_space', value: rootId, updatedAt: at(-90) },
    { id: 'workspace', value: WORKSPACE, updatedAt: at(-90) },
  ]);
  await ins(s.spaceMembers, [
    // Workspace: everyone except guests (as ensureRootSpace)
    ...USERS.filter(([, , role]) => role !== 'guest').map(([l]) => ({
      id: uid(`member:root:${l}`),
      spaceId: rootId,
      userId: uid_[l],
      role: l === 'maya' ? 'admin' : 'member',
      createdAt: at(-90),
      updatedAt: at(-90),
    })),
    ...spaceIds.flatMap((sid, si) =>
      USERS.map(([l, , role]) => ({
        id: uid(`member:${si}:${l}`),
        spaceId: sid,
        userId: uid_[l],
        role: l === 'maya' ? 'admin' : role === 'guest' ? 'guest' : 'member',
        createdAt: at(-90),
        updatedAt: at(-90),
      })),
    ),
  ]);
  const stRanks = generateNKeysBetween(null, null, STATUSES.length);
  // statuses and labels belong to a project (PJ-1)
  const statusId = (key: string, k: number) => uid(`status:${key}:${k}`);
  const labelId = (key: string, name: string) => uid(`label:${key}:${name}`);

  // projects and tasks
  const prRanks = generateNKeysBetween(null, null, PROJECTS.length);
  const pid = (key: string) => uid(`project:${key}`);
  await ins(
    s.projects,
    PROJECTS.map((p, i) => ({
      id: pid(p.key),
      spaceId: spaceIds[p.space],
      name: p.name,
      key: p.key,
      rank: prRanks[i],
      leadId: uid_[p.space === 1 ? 'liam' : 'maya'],
      taskCounter: p.tasks.length,
      modules: [...DATA_MODULE_IDS], // demo data of the modules is visible
      color: SPACES[p.space]![2],
      icon: p.icon,
      createdAt: at(-80),
      updatedAt: at(-80),
    })),
  );
  await ins(
    s.statuses,
    PROJECTS.flatMap((p) =>
      STATUSES.map(([name, category, color], k) => ({
        id: statusId(p.key, k),
        spaceId: spaceIds[p.space],
        projectId: pid(p.key),
        name,
        category,
        color,
        rank: stRanks[k],
        createdAt: at(-80),
        updatedAt: at(-80),
      })),
    ),
  );
  await ins(
    s.labels,
    PROJECTS.flatMap((p) =>
      LABELS.map(([name, color]) => ({
        id: labelId(p.key, name),
        spaceId: spaceIds[p.space],
        projectId: pid(p.key),
        name,
        color,
        createdAt: at(-80),
        updatedAt: at(-80),
      })),
    ),
  );
  const tid = (key: string, i: number) => uid(`task:${key}:${i}`);
  // custom fields: [project, name, type, select choices]
  const FIELDS: [string, string, string, string[]][] = [
    ['PLT', 'Effort', 'select', ['S', 'M', 'L', 'XL']],
    ['RDM', 'Impact', 'select', ['Low', 'Medium', 'High']],
    ['RDM', 'Votes', 'number', []],
    ['SUP', 'Customer', 'text', []],
  ];
  const fieldId = (key: string, name: string) => uid(`field:${key}:${name}`);
  const CUSTOMERS = ['Acme Corp', 'Northwind Logistics', 'Globex', 'Initech'];
  const fieldsOf = (key: string, i: number): Record<string, unknown> =>
    key === 'PLT'
      ? { [fieldId(key, 'Effort')]: ['S', 'M', 'L', 'XL'][(i * 3) % 4] }
      : key === 'RDM'
        ? {
            [fieldId(key, 'Impact')]: ['Low', 'Medium', 'High'][(i + 2) % 3],
            [fieldId(key, 'Votes')]: 5 + ((i * 17) % 60),
          }
        : key === 'SUP' && i % 3 !== 1
          ? { [fieldId(key, 'Customer')]: CUSTOMERS[i % 4] }
          : {};
  await ins(
    s.fieldDefs,
    FIELDS.map(([key, name, type, choices], k) => ({
      id: fieldId(key, name),
      spaceId: spaceIds[PROJECTS.find((p) => p.key === key)!.space],
      projectId: pid(key),
      name,
      type,
      options: choices.length ? { choices: choices.map((c) => ({ id: c, label: c })) } : {},
      rank: generateNKeysBetween(null, null, FIELDS.length)[k],
      createdAt: at(-80),
      updatedAt: at(-80),
    })),
  );
  const cycleOf = (key: string, t: T) =>
    key !== 'PLT'
      ? null
      : t[1] === 3
        ? uid(`cycle:${t[3]! < -14 ? 1 : 2}`)
        : t[1] === 1 || t[1] === 2
          ? uid('cycle:2')
          : null;
  const tasks: Record<string, unknown>[] = [];
  const assignees: Record<string, unknown>[] = [];
  const taskLabels: Record<string, unknown>[] = [];
  const activity: Record<string, unknown>[] = [];
  for (const p of PROJECTS) {
    const ranks = generateNKeysBetween(null, null, p.tasks.length);
    p.tasks.forEach((t, i) => {
      const [title, st, pr, due, who, lbls, parent] = t;
      const id = tid(p.key, i);
      const created = -cap(60 - i * 2, 3, 60);
      const done = st === 3 || st === 4;
      tasks.push({
        id,
        spaceId: spaceIds[p.space],
        projectId: pid(p.key),
        number: i + 1,
        parentId: parent !== undefined ? tid(p.key, parent) : null,
        statusId: statusId(p.key, st),
        title,
        description: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: `${title}. See the linked docs and the discussion below for context.`,
                },
              ],
            },
          ],
        },
        priority: pr,
        rank: ranks[i],
        dueDate: due !== null ? day(due) : null,
        startDate: due !== null && st === 2 ? day(due - 7) : null,
        createdBy: uid_[who.split(',')[0]!],
        completedAt: done ? at(due !== null ? Math.min(due, -1) : -1) : null,
        cycleId: cycleOf(p.key, t),
        fields: fieldsOf(p.key, i),
        createdAt: at(created),
        updatedAt: at(done ? Math.min(due ?? -1, -1) : cap(-(i % 5), -4, 0)),
      });
      for (const l of who.split(','))
        assignees.push({
          id: uid(`assignee:${id}:${l}`),
          spaceId: spaceIds[p.space],
          taskId: id,
          userId: uid_[l],
          createdAt: at(created),
        });
      taskLabels.push({
        id: uid(`tlabel:${id}`),
        spaceId: spaceIds[p.space],
        taskId: id,
        labelId: labelId(p.key, lbls),
        createdAt: at(created),
      });
      activity.push({
        id: uid(`activity:${id}`),
        spaceId: spaceIds[p.space],
        taskId: id,
        actorId: uid_[who.split(',')[0]!],
        kind: 'created',
        changes: {},
        createdAt: at(created),
      });
    });
  }
  await ins(
    s.tasks,
    tasks.sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0)),
  );
  await ins(s.taskAssignees, assignees);
  await ins(s.taskLabels, taskLabels);
  await ins(s.taskLinks, [
    {
      id: uid('link:1'),
      spaceId: spaceIds[1],
      taskId: tid('PLT', 3),
      targetId: tid('PLT', 6),
      kind: 'blocks',
      createdBy: uid_.liam,
      createdAt: at(-5),
    },
    {
      id: uid('link:2'),
      spaceId: spaceIds[1],
      taskId: tid('PLT', 4),
      targetId: tid('MOB', 2),
      kind: 'relates',
      createdBy: uid_.noah,
      createdAt: at(-4),
    },
  ]);

  // favourites of demo (PLNRAPP-124): a project, a space, a task, a doc and a channel
  const favs: [string, string, string, string][] = [
    ['project', pid('PLT'), 'Platform', `/p/${pid('PLT')}/list`],
    ['space', spaceIds[0]!, 'Product', `/s/${spaceIds[0]}/work`],
    ['task', tid('RDM', 2), PROJECTS[0]!.tasks[2]![0], '/t/RDM-3'],
    ['doc', uid('page:2'), 'Architecture overview', `/s/${spaceIds[1]}/docs?page=${uid('page:2')}`],
    ['chat', uid('channel:1'), 'dev', `/s/${spaceIds[1]}/chats?c=${uid('channel:1')}`],
  ];
  await ins(
    s.favorites,
    favs.map(([kind, refId, name, url], k) => ({
      id: uid(`fav:${kind}:${refId}`),
      userId: uid_.demo,
      kind,
      refId,
      name,
      url,
      rank: generateNKeysBetween(null, null, favs.length)[k],
      createdAt: at(-10),
      updatedAt: at(-10),
    })),
  );

  // comments with @mentions, reactions, checklists
  const pkIdx = (key: string) => PROJECTS.findIndex((p) => p.key === key);
  const userList = USERS.map(([login]) => ({ id: uid_[login]!, login }));
  const comments = COMMENTS.map(([key, i, author, text], k) => {
    const body = textToDoc(text, userList);
    const mentions = extractMentions(body);
    return {
      id: uid(`comment:${k}`),
      spaceId: spaceIds[PROJECTS[pkIdx(key)]!.space],
      taskId: tid(key, i),
      authorId: uid_[author],
      body,
      mentions,
      // a comment addressed to demo is assigned to them — «Comments for me» and its tab count
      assigneeId: mentions.includes(uid_.demo!) ? uid_.demo : null,
      createdAt: at(-9 + k * 0.5, 10 + (k % 6)),
      updatedAt: at(-9 + k * 0.5, 10 + (k % 6)),
    };
  });
  await ins(s.comments, comments);
  await ins(
    s.commentReactions,
    comments
      .filter((_, k) => k % 3 === 0)
      .map((c, k) => ({
        id: uid(`creaction:${k}`),
        spaceId: c.spaceId,
        commentId: c.id,
        userId: uid_[k % 2 ? 'maya' : 'demo'],
        emoji: k % 2 ? '👍' : '🎉',
        createdAt: c.createdAt,
      })),
  );
  for (const c of comments)
    activity.push({
      id: uid(`activity:${c.id}`),
      spaceId: c.spaceId,
      taskId: c.taskId,
      actorId: c.authorId,
      kind: 'commented',
      changes: {},
      createdAt: c.createdAt,
    });
  await ins(s.activity, activity);
  const cRanks = generateNKeysBetween(null, null, 8);
  await ins(
    s.checklistItems,
    CHECKLISTS.flatMap(([key, i, items]) =>
      items.map(([text, done], k) => ({
        id: uid(`check:${key}:${i}:${k}`),
        spaceId: spaceIds[PROJECTS[pkIdx(key)]!.space],
        taskId: tid(key, i),
        text,
        done,
        rank: cRanks[k],
        createdAt: at(-10),
        updatedAt: at(-3),
      })),
    ),
  );
  await ins(
    s.notifications,
    comments
      .filter((c) => c.mentions.includes(uid_.demo!))
      .map((c, k) => ({
        id: uid(`notif:${k}`),
        userId: uid_.demo,
        spaceId: c.spaceId,
        kind: 'mentioned',
        taskId: c.taskId,
        commentId: c.id,
        actorId: c.authorId,
        body: 'mentioned you in a comment',
        readAt: k === 0 ? null : at(-1),
        createdAt: c.createdAt,
      })),
  );

  // sprints (Platform): one closed, one active
  const plt = pid('PLT');
  await ins(sprintsSettings, [
    {
      id: uid('sprintcfg'),
      spaceId: spaceIds[1],
      projectId: plt,
      enabled: true,
      lengthDays: 14,
      timezone: 'UTC',
      autoCreate: true,
      createdAt: at(-30),
      updatedAt: at(-30),
    },
  ]);
  await ins(sprintsCycles, [
    {
      id: uid('cycle:1'),
      spaceId: spaceIds[1],
      projectId: plt,
      number: 1,
      name: 'Sprint 1',
      startDate: day(-21),
      endDate: day(-8),
      closedAt: at(-7),
      createdAt: at(-22),
      updatedAt: at(-7),
    },
    {
      id: uid('cycle:2'),
      spaceId: spaceIds[1],
      projectId: plt,
      number: 2,
      name: 'Sprint 2',
      startDate: day(-7),
      endDate: day(6),
      closedAt: null,
      createdAt: at(-8),
      updatedAt: at(-8),
    },
  ]);

  // milestones, goals
  const ms = [
    ['RDM', 'Public beta', 21, 'Open the product to everyone on the waitlist.', [2, 4]],
    ['RDM', 'General availability', 45, 'Pricing, onboarding and support ready for GA.', [3, 5, 9]],
    ['PLT', 'API v2 freeze', 14, 'No more breaking changes after this date.', [3, 5, 6, 12]],
    ['MKT', 'Press kit ready', 10, 'Logos, screenshots and boilerplate published.', [1]],
    ['MKT', 'Launch day', 30, 'Product Hunt launch and announcement email.', [0, 2, 3]],
  ] as const;
  await ins(
    goalsMilestones,
    ms.map(([key, name, d, description], k) => ({
      id: uid(`ms:${k}`),
      spaceId: spaceIds[PROJECTS[pkIdx(key)]!.space],
      projectId: pid(key),
      name,
      date: day(d),
      description,
      createdAt: at(-30),
      updatedAt: at(-30),
    })),
  );
  await ins(
    goalsMilestoneTasks,
    ms.flatMap(([key, , , , idx], k) =>
      idx.map((i) => ({
        id: uid(`mst:${k}:${i}`),
        spaceId: spaceIds[PROJECTS[pkIdx(key)]!.space],
        milestoneId: uid(`ms:${k}`),
        taskId: tid(key, i),
        createdAt: at(-30),
      })),
    ),
  );
  const gRanks = generateNKeysBetween(null, null, 3);
  const goalDefs = [
    [
      0,
      'Reach 1,000 active teams',
      'maya',
      60,
      { start: 200, target: 1000, current: 640, unit: 'teams' },
      'RDM',
    ],
    [1, 'Ship API v2', 'liam', 14, { start: 0, target: 100, current: 55, unit: '%' }, 'PLT'],
    [
      2,
      'Grow newsletter to 10k subscribers',
      'emma',
      45,
      { start: 2500, target: 10000, current: 4200, unit: 'subscribers' },
      'MKT',
    ],
  ] as const;
  await ins(
    goalsGoals,
    goalDefs.map(([si, name, owner, d], k) => ({
      id: uid(`goal:${k}`),
      spaceId: spaceIds[si],
      name,
      description: 'Quarterly objective tracked by key results.',
      ownerId: uid_[owner],
      dueDate: day(d),
      rank: gRanks[k],
      createdBy: maya,
      createdAt: at(-30),
      updatedAt: at(-30),
    })),
  );
  await ins(
    goalsKeyResults,
    goalDefs.flatMap(([si, name, , , metric, key], k) => [
      {
        id: uid(`kr:${k}:0`),
        spaceId: spaceIds[si],
        goalId: uid(`goal:${k}`),
        name: `${name}: headline metric`,
        kind: 'number',
        metric,
        filter: null,
        rank: 'a0',
        createdAt: at(-30),
        updatedAt: at(-2),
      },
      {
        id: uid(`kr:${k}:1`),
        spaceId: spaceIds[si],
        goalId: uid(`goal:${k}`),
        name: 'Complete all planned tasks',
        kind: 'tasks',
        metric: null,
        filter: { projectIds: [pid(key)], filter: { op: 'and', rules: [] } },
        rank: 'a1',
        createdAt: at(-30),
        updatedAt: at(-2),
      },
    ]),
  );

  // time tracking: four weeks of finished entries (time reports), a running timer for demo
  const entries: Record<string, unknown>[] = [];
  const timeWork: [string, string, number[]][] = [
    ['liam', 'PLT', [3, 7, 12]],
    ['demo', 'PLT', [3, 6, 13]],
    ['noah', 'PLT', [4, 11]],
    ['omar', 'PLT', [5, 9]],
    ['ava', 'MOB', [0, 1]],
    ['jack', 'MOB', [2, 5]],
    ['emma', 'MKT', [0, 1, 4]],
    ['sofia', 'RDM', [3, 7]],
  ];
  for (let d = 1; d <= 26; d++)
    for (const [ui, [u, key, idx]] of timeWork.entries()) {
      if ((d + ui) % 7 === 5 || (d + ui) % 7 === 6) continue; // quiet days
      const taskIdx = idx[(d + ui) % idx.length]!;
      const sec = 900 * (4 + Math.floor(rnd() * 12)); // 1–4 h
      const start = at(-d, 8 + (ui % 4));
      entries.push({
        id: uid(`time:${d}:${u}`),
        spaceId: spaceIds[PROJECTS[pkIdx(key)]!.space],
        taskId: tid(key, taskIdx),
        userId: uid_[u],
        startedAt: start,
        endedAt: new Date(Date.parse(start) + sec * 1000).toISOString(),
        durationSec: sec,
        note: ['Implementation', 'Code review', 'Debugging', 'Pairing session'][(d + ui) % 4],
        source: d % 3 ? 'timer' : 'manual',
        createdAt: start,
        updatedAt: start,
      });
    }
  entries.push({
    id: uid('time:running:demo'),
    spaceId: spaceIds[1],
    taskId: tid('PLT', 6),
    userId: uid_.demo,
    startedAt: new Date(now.getTime() - 47 * 60_000).toISOString(),
    endedAt: null,
    durationSec: null,
    note: null,
    source: 'timer',
    createdAt: new Date(now.getTime() - 47 * 60_000).toISOString(),
    updatedAt: new Date(now.getTime() - 47 * 60_000).toISOString(),
  });
  await ins(timeEntries, entries);
  const estimated = timeWork.flatMap(([, key, idx]) => idx.map((i) => [key, i] as const));
  await ins(
    timeEstimates,
    [...new Map(estimated.map((e) => [`${e[0]}:${e[1]}`, e])).values()].map(([key, i], k) => ({
      id: uid(`est:${key}:${i}`),
      spaceId: spaceIds[PROJECTS[pkIdx(key)]!.space],
      taskId: tid(key, i),
      minutes: 240 + (k % 6) * 120,
      updatedBy: uid_.liam,
      updatedAt: at(-14),
    })),
  );

  // dashboards
  const boards = [
    { si: 0, name: 'Product overview', key: 'RDM' },
    { si: 1, name: 'Engineering health', key: 'PLT' },
  ];
  const bRanks = generateNKeysBetween(null, null, 2);
  await ins(
    dashboardsBoards,
    boards.map((b, k) => ({
      id: uid(`board:${k}`),
      spaceId: spaceIds[b.si],
      userId: null,
      name: b.name,
      rank: bRanks[k],
      createdBy: maya,
      createdAt: at(-20),
      updatedAt: at(-20),
    })),
  );
  const f = (...rules: { field: string; operator: string; value?: unknown }[]) => ({
    op: 'and',
    rules,
  });
  await ins(
    dashboardsWidgets,
    boards.flatMap((b, k) => {
      const w = (
        n: number,
        kind: string,
        title: string,
        config: Record<string, unknown>,
        x: number,
        y: number,
        ww: number,
        h: number,
      ) => ({
        id: uid(`widget:${k}:${n}`),
        dashboardId: uid(`board:${k}`),
        spaceId: spaceIds[b.si],
        userId: null,
        kind,
        title,
        config,
        x,
        y,
        w: ww,
        h,
        createdAt: at(-20),
        updatedAt: at(-20),
      });
      return [
        w(
          0,
          'number',
          'Open tasks',
          {
            filter: f({ field: 'statusCategory', operator: 'in', value: ['todo', 'in_progress'] }),
          },
          0,
          0,
          3,
          2,
        ),
        w(
          1,
          'number',
          'Overdue',
          {
            filter: f(
              { field: 'statusCategory', operator: 'in', value: ['todo', 'in_progress'] },
              { field: 'dueDate', operator: 'before', value: 'today' },
            ),
          },
          3,
          0,
          3,
          2,
        ),
        w(2, 'bars', 'Tasks by status', { filter: f(), groupBy: 'status' }, 6, 0, 6, 4),
        w(
          3,
          'line',
          'Completed per week',
          { filter: f(), series: 'completed', weeks: 8 },
          0,
          2,
          6,
          4,
        ),
        w(
          4,
          'list',
          'Due soon',
          {
            filter: f({ field: 'statusCategory', operator: 'in', value: ['todo', 'in_progress'] }),
            sort: 'dueDate',
            limit: 8,
          },
          0,
          6,
          12,
          4,
        ),
      ];
    }),
  );

  // docs
  const dRanks = generateNKeysBetween(null, null, DOCS.length);
  await ins(
    docsPages,
    DOCS.map((d, k) => {
      const body = {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: d.title }] },
          ...d.paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
        ],
      };
      return {
        id: uid(`page:${k}`),
        spaceId: sp(d.space),
        projectId: d.project ? pid(d.project) : null,
        parentId: d.parent !== undefined ? uid(`page:${d.parent}`) : null,
        rank: dRanks[k],
        title: d.title,
        icon: d.icon,
        body,
        text: [d.title, ...d.paras].join(' '),
        files: [],
        createdBy: maya,
        updatedBy: maya,
        createdAt: at(-40 + k),
        updatedAt: at(-10 + k),
      };
    }),
  );
  await ins(docsTaskLinks, [
    {
      id: uid('dlink:0'),
      spaceId: spaceIds[1],
      pageId: uid('page:2'),
      taskId: tid('PLT', 3),
      createdBy: maya,
      createdAt: at(-8),
    },
    {
      id: uid('dlink:1'),
      spaceId: spaceIds[0],
      pageId: uid('page:1'),
      taskId: tid('RDM', 2),
      createdBy: maya,
      createdAt: at(-8),
    },
  ]);

  // chat: channels with conversation, one thread, two DMs
  const channels: Record<string, unknown>[] = [];
  const members: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];
  const reactions: Record<string, unknown>[] = [];
  const reads: Record<string, unknown>[] = [];
  const addChannel = (
    cid: string,
    spaceIdx: number | null,
    kind: string,
    name: string | null,
    topic: string | null,
    msgs: [string, string, number?][],
    who: string[],
    project?: string,
  ) => {
    let seq = 0;
    let lastAt = at(-3);
    msgs.forEach(([author, text], k) => {
      seq++;
      const body = textToDoc(text, userList);
      lastAt = at(-3 + k * 0.1, 9 + k);
      const hasThread = k === 1;
      messages.push({
        id: uid(`msg:${cid}:${k}`),
        spaceId: spaceIdx === null ? null : sp(spaceIdx),
        channelId: cid,
        parentId: null,
        seq,
        authorId: uid_[author],
        body,
        mentions: extractMentions(body),
        attachments: [],
        replyCount: hasThread ? 2 : 0,
        lastReplyAt: hasThread ? at(-2.9, 12) : null,
        createdAt: lastAt,
        updatedAt: lastAt,
      });
      if (hasThread)
        ['maya', 'demo'].forEach((a, r) => {
          const rb = textToDoc(
            r ? 'Agreed, let us go with that.' : 'Thanks, that matches what I saw.',
            userList,
          );
          messages.push({
            id: uid(`msg:${cid}:${k}:r${r}`),
            spaceId: spaceIdx === null ? null : sp(spaceIdx),
            channelId: cid,
            parentId: uid(`msg:${cid}:${k}`),
            seq: null,
            authorId: uid_[a],
            body: rb,
            mentions: [],
            attachments: [],
            replyCount: 0,
            createdAt: at(-2.9, 11 + r),
            updatedAt: at(-2.9, 11 + r),
          });
        });
      if (k === 0)
        reactions.push({
          id: uid(`mreact:${cid}`),
          spaceId: spaceIdx === null ? null : sp(spaceIdx),
          channelId: cid,
          messageId: uid(`msg:${cid}:0`),
          userId: uid_.demo,
          emoji: '👍',
          createdAt: lastAt,
        });
    });
    channels.push({
      id: cid,
      spaceId: spaceIdx === null ? null : sp(spaceIdx),
      projectId: project ? pid(project) : null,
      kind,
      name,
      topic,
      createdBy: maya,
      lastSeq: seq,
      lastMessageAt: lastAt,
      createdAt: at(-60),
      updatedAt: lastAt,
    });
    for (const u of who) {
      if (kind === 'dm')
        members.push({
          id: uid(`cm:${cid}:${u}`),
          channelId: cid,
          userId: uid_[u],
          addedBy: maya,
          createdAt: at(-60),
        });
      reads.push({
        id: uid(`cr:${cid}:${u}`),
        userId: uid_[u],
        channelId: cid,
        lastReadSeq:
          u === 'demo' && kind === 'channel' && name === 'dev' ? Math.max(0, seq - 2) : seq,
        muted: false,
        updatedAt: lastAt,
      });
    }
  };
  CHANNELS.forEach((c, k) =>
    addChannel(
      uid(`channel:${k}`),
      c.space,
      'channel',
      c.name,
      c.topic,
      c.msgs,
      USERS.map(([l]) => l).filter((l) => l !== 'nina'),
      c.project,
    ),
  );
  addChannel(
    uid('dm:1'),
    null,
    'dm',
    null,
    null,
    [
      ['maya', 'Hi! Can you present the beta plan on Thursday?'],
      ['demo', 'Sure, I will prepare a short deck.'],
    ],
    ['maya', 'demo'],
  );
  addChannel(
    uid('dm:2'),
    null,
    'dm',
    null,
    null,
    [
      ['liam', 'Pairing on pagination at 3pm?'],
      ['demo', 'Works for me.'],
      ['liam', 'Great, sending a link.'],
    ],
    ['liam', 'demo'],
  );
  await ins(chatChannels, channels);
  await ins(chatMembers, members);
  await ins(
    chatMessages,
    messages.sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0)),
  );
  await ins(chatReactions, reactions);
  await ins(chatReads, reads);

  // recurring tasks (the task carries the rule)
  const rec: [string, number, string, number, string, number[], number][] = [
    ['SUP', 5, 'weekdays', 1, 'week', [1], 2],
    ['PLT', 8, 'interval', 2, 'week', [], 5],
    ['MKT', 7, 'interval', 1, 'month', [], 12],
  ];
  await ins(
    recurringRules,
    rec.map(([key, i, kind, every, unit, weekdays, next], k) => ({
      id: uid(`rrule:${k}`),
      spaceId: spaceIds[PROJECTS[pkIdx(key)]!.space],
      taskId: tid(key, i),
      kind,
      every,
      unit,
      weekdays,
      anchorDate: day(next - 14),
      nextDate: day(next),
      timezone: 'UTC',
      createdBy: maya,
      createdAt: at(-30),
      updatedAt: at(-30),
    })),
  );

  // saved views for everyone (tabs in Tasks of the space's nodes)
  const VIEWS: [number, string, string, string, Record<string, unknown>][] = [
    [
      1,
      'Hot bugs',
      'flame',
      'list',
      {
        op: 'and',
        rules: [
          { field: 'priority', operator: 'gte', value: 3 },
          { field: 'statusCategory', operator: 'in', value: ['todo', 'in_progress'] },
        ],
      },
    ],
    [
      1,
      'Current sprint',
      'zap',
      'board',
      { op: 'and', rules: [{ field: 'cycle', operator: 'in', value: [uid('cycle:2')] }] },
    ],
    [
      0,
      'Due this month',
      'calendar',
      'calendar',
      { op: 'and', rules: [{ field: 'dueDate', operator: 'isNotEmpty' }] },
    ],
  ];
  await ins(
    s.savedViews,
    VIEWS.map(([si, name, icon, layout, filter], k) => ({
      id: uid(`view:${k}`),
      spaceId: spaceIds[si],
      userId: null,
      createdBy: maya,
      name,
      icon,
      layout,
      node: null,
      filter,
      config: {},
      rank: generateNKeysBetween(null, null, VIEWS.length)[k],
      createdAt: at(-20),
      updatedAt: at(-20),
    })),
  );

  // «My day» of demo and the tasks demo watches
  const myDay: [string, number][] = [
    ['RDM', 4],
    ['PLT', 6],
    ['MKT', 3],
    ['SUP', 1],
  ];
  await ins(
    s.dayPlans,
    myDay.map(([key, i], k) => ({
      id: uid(`dayplan:${key}:${i}`),
      userId: uid_.demo,
      taskId: tid(key, i),
      date: day(0),
      rank: generateNKeysBetween(null, null, myDay.length)[k],
      createdAt: at(0, 8),
      updatedAt: at(0, 8),
    })),
  );
  const watched: [string, number][] = [
    ['PLT', 4],
    ['MOB', 2],
    ['MKT', 2],
    ['SUP', 6],
  ];
  await ins(
    s.taskWatchers,
    watched.map(([key, i]) => ({
      id: uid(`watch:${key}:${i}`),
      spaceId: spaceIds[PROJECTS[pkIdx(key)]!.space],
      taskId: tid(key, i),
      userId: uid_.demo,
      createdAt: at(-5),
    })),
  );

  // automations
  const RULES: [string, string, unknown, unknown, unknown[]][] = [
    [
      'SUP',
      'Bugs go to Omar with high priority',
      { type: 'task.created' },
      { op: 'and', rules: [{ field: 'label', operator: 'in', value: [labelId('SUP', 'bug')] }] },
      [
        { type: 'assign', userId: uid_.omar },
        { type: 'set_field', field: 'priority', value: 3 },
      ],
    ],
    [
      'PLT',
      'Say thanks when a task is done',
      { type: 'task.status_changed', to: [statusId('PLT', 3)] },
      { op: 'and', rules: [] },
      [{ type: 'add_comment', text: 'Shipped, thank you! 🎉' }],
    ],
    [
      'MKT',
      'Remind two days before the due date',
      { type: 'task.due', daysBefore: 2 },
      { op: 'and', rules: [] },
      [{ type: 'add_comment', text: 'Due in two days. Anything blocking?' }],
    ],
  ];
  await ins(
    automationsRules,
    RULES.map(([key, name, trigger, conditions, actions], k) => ({
      id: uid(`rule:${k}`),
      spaceId: spaceIds[PROJECTS[pkIdx(key)]!.space],
      projectId: pid(key),
      name,
      enabled: true,
      trigger,
      conditions,
      actions,
      createdBy: maya,
      createdAt: at(-25),
      updatedAt: at(-25),
    })),
  );

  // templates: a bug report task and a launch project
  const tTask = (title: string, priority: number, checklist: string[] = []) => ({
    title,
    description: null,
    priority,
    dueInDays: null,
    startInDays: null,
    fields: [],
    labels: [],
    assigneeIds: [],
    checklist,
  });
  await ins(templatesTemplates, [
    {
      id: uid('template:bug'),
      spaceId: spaceIds[1],
      kind: 'task',
      name: 'Bug report',
      description: 'Steps, expected and actual result',
      data: {
        ...tTask('Bug: ', 3, [
          'Steps to reproduce',
          'Expected result',
          'Actual result',
          'Add a test',
        ]),
        labels: ['bug'],
        subtasks: [],
      },
      createdBy: uid_.liam,
      createdAt: at(-40),
      updatedAt: at(-40),
    },
    {
      id: uid('template:launch'),
      spaceId: spaceIds[2],
      kind: 'project',
      name: 'Product launch',
      description: 'Four-week launch plan',
      data: {
        project: { description: null, color: '#ec4899', icon: '🚀' },
        statuses: STATUSES.map(([name, category, color]) => ({ name, category, color })),
        labels: LABELS.map(([name, color]) => ({ name, color })),
        fields: [],
        tasks: [
          { ...tTask('Landing page', 3), dueInDays: 14, status: 'Todo', subtasks: [] },
          { ...tTask('Press kit', 2), dueInDays: 21, status: 'Todo', subtasks: [] },
          {
            ...tTask('Launch day', 4, ['Post on Product Hunt', 'Send newsletter', 'Team on chat']),
            dueInDays: 28,
            status: 'Backlog',
            subtasks: [],
          },
        ],
      },
      createdBy: uid_.emma,
      createdAt: at(-40),
      updatedAt: at(-40),
    },
  ]);

  // public form: customers report problems into Help Center
  await ins(formsForms, [
    {
      id: uid('form:sup'),
      spaceId: spaceIds[4],
      projectId: pid('SUP'),
      slug: 'brightwavehelp01',
      title: 'Report a problem',
      description: 'Tell us what went wrong, we answer within 4 working hours.',
      fields: [
        { key: 'title', label: 'What happened?', required: true },
        { key: 'description', label: 'Details', required: false },
        { key: 'email', label: 'Your email', required: true },
        { key: `field:${fieldId('SUP', 'Customer')}`, label: 'Company', required: false },
      ],
      statusId: statusId('SUP', 0),
      enabled: true,
      createdBy: uid_.omar,
      createdAt: at(-30),
      updatedAt: at(-30),
    },
  ]);

  // workload: weekly capacity in Engineering
  await ins(
    workloadCapacities,
    (['liam', 'demo', 'noah', 'omar', 'ava', 'jack'] as const).map((u, k) => ({
      id: uid(`capacity:${u}`),
      spaceId: spaceIds[1],
      userId: uid_[u],
      hoursPerWeek: [40, 32, 40, 40, 24, 40][k],
      updatedBy: uid_.liam,
      updatedAt: at(-30),
    })),
  );
}

async function main() {
  const reset = process.argv.includes('--reset');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = createDb(url);
  try {
    await migrate(db);
    await (reset ? resetDemo(db) : seedDemo(db));
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
