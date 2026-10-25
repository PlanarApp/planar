import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { Db, JobDef } from '@planar/server-kit';
import { decrypt, secretKey } from './crypto.js';
import { emailConfig as C } from './schema.js';

const log = new Logger('email');
const MIN = 60_000;
const HOUR = 3_600_000;

export type Kind = 'notify' | 'digest';
export interface SmtpCfg {
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  password: string | null;
  from: string;
}
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  unsub: string;
}
export type Send = (cfg: SmtpCfg, m: Mail) => Promise<void>;

export const publicUrl = () =>
  (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, '');

// --- токен отписки: <userId>.<kind>.<sig> ---
const sig = (key: Buffer, userId: string, kind: Kind) =>
  createHmac('sha256', key).update(`email-unsub:v1:${userId}:${kind}`).digest('base64url');
export const unsubToken = (key: Buffer, userId: string, kind: Kind) =>
  `${userId}.${kind}.${sig(key, userId, kind)}`;
export function parseUnsub(key: Buffer, t: unknown): { userId: string; kind: Kind } | null {
  const [userId, kind, s, extra] = typeof t === 'string' ? t.split('.') : [];
  if (extra !== undefined || !userId || (kind !== 'notify' && kind !== 'digest') || !s) return null;
  const a = Buffer.from(s);
  const b = Buffer.from(sig(key, userId, kind));
  return a.length === b.length && timingSafeEqual(a, b) ? { userId, kind } : null;
}

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Конфиг с расшифрованным паролем; нет настроек или ключа (писем нет) → null. */
export async function loadCfg(q: Pick<Db, 'select'>): Promise<SmtpCfg | null> {
  const [r] = await q.select().from(C);
  const key = secretKey();
  if (!r || !r.host || !r.fromAddress || !key) return null;
  return {
    host: r.host,
    port: r.port,
    secure: r.secure,
    username: r.username,
    password: r.passwordEnc ? decrypt(r.passwordEnc, key) : null,
    from: r.fromAddress,
  };
}

export const send: Send = async (cfg, m) => {
  const t = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await t.sendMail({
      from: cfg.from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
      headers: {
        'List-Unsubscribe': `<${m.unsub}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  } finally {
    t.close();
  }
};

/** Текст ошибки SMTP без пароля и с ограничением длины. */
export const safeErr = (e: unknown, cfg?: SmtpCfg | null) => {
  let s = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  if (cfg?.password) s = s.split(cfg.password).join('***');
  return s;
};

const KINDS = ['assigned', 'mentioned', 'chat_mention'];
const SUBJECT: Record<string, string> = {
  assigned: 'Вас назначили исполнителем',
  mentioned: 'Вас упомянули',
  chat_mention: 'Вас упомянули в чате',
};
type Row = Record<string, unknown>;
const rowsOf = async (db: Pick<Db, 'execute'>, q: ReturnType<typeof sql>) =>
  (await db.execute(q)).rows as Row[];

/** Ссылка: задача — /t/<KEY>-<n>, иначе notifications.url (только путь, как в Web Push). */
function link(n: Row): string {
  const path = n.key && n.number ? `/t/${n.key}-${n.number}` : String(n.url ?? '');
  return publicUrl() + (path.startsWith('/') && !path.startsWith('//') ? path : '');
}

const wrap = (body: string, unsub: string, what: string) =>
  `<div style="font-family:sans-serif;font-size:14px;color:#222">${body}` +
  `<p style="color:#888;font-size:12px;margin-top:24px">Вы получили это письмо, потому что включили ${what} в Planar. ` +
  `<a href="${esc(unsub)}">Отписаться</a></p></div>`;

/** Cron email.notify: now — «сейчас» (в тестах — подставляется). Возвращает число отправленных. */
export async function notifyTick(db: Db, now: Date, snd: Send = send): Promise<number> {
  const cfg = await loadCfg(db);
  const key = secretKey();
  if (!cfg || !key) return 0;
  const cand = await rowsOf(
    db,
    sql`select n.id, n.user_id as "userId", n.kind, n.url, n.body, u.email, a.name as actor,
        t.title, t.number, p.key
      from notifications n
      join users u on u.id = n.user_id and u.deactivated_at is null and coalesce(u.email, '') <> ''
      join users a on a.id = n.actor_id
      left join tasks t on t.id = n.task_id
      left join projects p on p.id = t.project_id
      left join email_prefs e on e.user_id = n.user_id
      where n.kind in (${sql.join(
        KINDS.map((k) => sql`${k}`),
        sql`, `,
      )}) and n.read_at is null
        and n.created_at >= ${new Date(+now - 24 * HOUR).toISOString()}
        and n.created_at <= ${new Date(+now - 10 * MIN).toISOString()}
        and coalesce(e.notify, true)
        and not exists (select 1 from email_outbox o where o.notification_id = n.id)
      order by n.created_at limit 200`,
  );
  let sent = 0;
  for (const n of cand) {
    const [ins] = await rowsOf(
      db,
      sql`insert into email_outbox (notification_id, user_id, status) values (${n.id}, ${n.userId}, 'sending')
        on conflict do nothing returning notification_id`,
    );
    if (!ins) continue;
    const [cur] = await rowsOf(db, sql`select read_at from notifications where id = ${n.id}`);
    const set = async (status: string, error: string | null = null) =>
      db.execute(
        sql`update email_outbox set status = ${status}, error = ${error}, sent_at = ${status === 'sent' ? now.toISOString() : null} where notification_id = ${n.id}`,
      );
    if (!cur || cur.read_at) {
      await set('skipped');
      continue;
    }
    const url = link(n);
    const what = String(n.title ?? n.body ?? '');
    const unsub = `${publicUrl()}/api/email/unsubscribe?t=${unsubToken(key, String(n.userId), 'notify')}`;
    const head = `${SUBJECT[String(n.kind)] ?? 'Уведомление'}: ${n.actor}`;
    try {
      await snd(cfg, {
        to: String(n.email),
        subject: `${head}${what ? ` — ${what.slice(0, 120)}` : ''}`.replace(/[\r\n]+/g, ' '),
        text: `${head}\n${what}\n${url}\n\nОтписаться: ${unsub}`,
        html: wrap(
          `<p><b>${esc(head)}</b></p><p>${esc(what)}</p><p><a href="${esc(url)}">${esc(url)}</a></p>`,
          unsub,
          'письма об уведомлениях',
        ),
        unsub,
      });
      await set('sent');
      sent++;
    } catch (e) {
      log.warn(`notify ${String(n.id)}: ${safeErr(e, cfg)}`);
      await set('failed', safeErr(e, cfg));
    }
  }
  return sent;
}

/** Сегодняшняя дата и час в поясе tz (неверный пояс → UTC). */
export function localDay(now: Date, tz: string): { date: string; hour: number } {
  const f = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  let parts;
  try {
    parts = f(tz);
  } catch {
    parts = f('UTC');
  }
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) };
}

/** Cron email.digest: раз в сутки на пользователя после 8:00 в settings.timezone. */
export async function digestTick(db: Db, now: Date, snd: Send = send): Promise<number> {
  const cfg = await loadCfg(db);
  const key = secretKey();
  if (!cfg || !key) return 0;
  const [tzRow] = await rowsOf(db, sql`select value from settings where id = 'timezone'`);
  const { date, hour } = localDay(now, typeof tzRow?.value === 'string' ? tzRow.value : 'UTC');
  if (hour < 8) return 0;
  const users = await rowsOf(
    db,
    sql`select u.id, u.email from email_prefs e
      join users u on u.id = e.user_id and u.deactivated_at is null and coalesce(u.email, '') <> ''
      where e.digest and not exists (select 1 from email_digests d where d.user_id = u.id and d.date = ${date})`,
  );
  let sent = 0;
  for (const u of users) {
    const [ins] = await rowsOf(
      db,
      sql`insert into email_digests (user_id, date, status) values (${u.id}, ${date}, 'sending')
        on conflict do nothing returning user_id`,
    );
    if (!ins) continue;
    const set = async (status: string, error: string | null = null) =>
      db.execute(
        sql`update email_digests set status = ${status}, error = ${error} where user_id = ${u.id} and date = ${date}`,
      );
    try {
      const unread = await rowsOf(
        db,
        sql`select n.kind, n.url, n.body, a.name as actor, t.title, t.number, p.key
          from notifications n join users a on a.id = n.actor_id
          left join tasks t on t.id = n.task_id left join projects p on p.id = t.project_id
          where n.user_id = ${u.id} and n.read_at is null and n.created_at >= ${new Date(+now - 24 * HOUR).toISOString()}
          order by n.created_at desc limit 50`,
      );
      const due = await rowsOf(
        db,
        sql`select t.title, t.number, t.due_date::text as due, p.key
          from tasks t join projects p on p.id = t.project_id and p.archived_at is null
          join task_assignees ta on ta.task_id = t.id and ta.user_id = ${u.id}
          join statuses s on s.id = t.status_id and s.category not in ('done', 'cancelled')
          where t.due_date <= ${date}::date order by t.due_date, p.key, t.number limit 100`,
      );
      if (!unread.length && !due.length) {
        await set('skipped');
        continue;
      }
      const unsub = `${publicUrl()}/api/email/unsubscribe?t=${unsubToken(key, String(u.id), 'digest')}`;
      const taskLine = (r: Row) => `${r.key}-${r.number} ${r.title}`;
      const lines = [
        ...(unread.length
          ? [
              'Непрочитанные уведомления:',
              ...unread.map(
                (n) =>
                  `• ${SUBJECT[String(n.kind)] ?? 'Уведомление'}: ${n.actor} — ${n.title ?? n.body ?? ''}`,
              ),
            ]
          : []),
        ...(due.length
          ? [
              '',
              'Задачи со сроком на сегодня или раньше:',
              ...due.map((r) => `• ${taskLine(r)} (${r.due})`),
            ]
          : []),
      ];
      const li = (s: string, href?: string) =>
        `<li>${href ? `<a href="${esc(href)}">${esc(s)}</a>` : esc(s)}</li>`;
      const html =
        (unread.length
          ? `<p><b>Непрочитанные уведомления</b></p><ul>${unread.map((n) => li(`${SUBJECT[String(n.kind)] ?? 'Уведомление'}: ${n.actor} — ${n.title ?? n.body ?? ''}`, link(n))).join('')}</ul>`
          : '') +
        (due.length
          ? `<p><b>Задачи со сроком на сегодня или раньше</b></p><ul>${due.map((r) => li(`${taskLine(r)} (${r.due})`, `${publicUrl()}/t/${r.key}-${r.number}`)).join('')}</ul>`
          : '');
      await snd(cfg, {
        to: String(u.email),
        subject: `Дайджест Planar за ${date}`,
        text: `${lines.join('\n')}\n\nОтписаться: ${unsub}`,
        html: wrap(html, unsub, 'ежедневный дайджест'),
        unsub,
      });
      await set('sent');
      sent++;
    } catch (e) {
      log.warn(`digest ${String(u.id)}: ${safeErr(e, cfg)}`);
      await set('failed', safeErr(e, cfg));
    }
  }
  return sent;
}

export const jobs: JobDef[] = [
  {
    queue: 'email.notify',
    cron: '* * * * *',
    retryLimit: 0,
    handler: async (_d, api) => void (await notifyTick(api.db, new Date())),
  },
  {
    queue: 'email.digest',
    cron: '0 * * * *',
    retryLimit: 0,
    handler: async (_d, api) => void (await digestTick(api.db, new Date())),
  },
];
