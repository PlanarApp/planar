import type { z } from 'zod';
import type { chatChannels, chatMembers, chatMessages, chatReactions, chatReads } from '../shared';

export type Channel = z.infer<typeof chatChannels>;
export type Member = z.infer<typeof chatMembers>;
export type Message = z.infer<typeof chatMessages>;
export type Reaction = z.infer<typeof chatReactions>;
export type Read = z.infer<typeof chatReads>;
export interface UserRow {
  id: string;
  name: string;
  deactivatedAt?: string | null;
}

/** Unread count of a channel: lastSeq − lastReadSeq; muted — no counter. */
export const unread = (c: Channel, r?: Read): number =>
  r?.muted ? 0 : Math.max(0, c.lastSeq - (r?.lastReadSeq ?? 0));

/** Direct 1:1 chat (me and one other person): no @-mentions, every message is a notification. */
export const isDirect = (c: Channel, members: Member[]) =>
  c.kind === 'dm' && members.filter((m) => m.channelId === c.id).length <= 2;

/** Notifications that light the chats counter: a mention or a 1:1 message. */
export const ATTENTION = ['chat_mention', 'chat_dm'];
const CHANNEL_URL = /^\/m\/chat\/c\/([0-9a-f-]{36})/;
export const channelOfUrl = (url: string | null | undefined) => CHANNEL_URL.exec(url ?? '')?.[1];

export const byName = (a: string, b: string) => a.localeCompare(b);

/** Dialog name — the members except me. */
export function dmTitle(c: Channel, members: Member[], users: Map<string, UserRow>, me: string) {
  return members
    .filter((m) => m.channelId === c.id && m.userId !== me)
    .map((m) => users.get(m.userId)?.name ?? '?')
    .sort(byName)
    .join(', ');
}

/** A dialog with exactly this set of members (including me), if one exists. */
export function findDm(channels: Channel[], members: Member[], ids: string[]): Channel | undefined {
  const want = [...new Set(ids)].sort().join();
  return channels.find(
    (c) =>
      c.kind === 'dm' &&
      members
        .filter((m) => m.channelId === c.id)
        .map((m) => m.userId)
        .sort()
        .join() === want,
  );
}

/** Feed order: by seq; without seq (and my unconfirmed ones) — at the end. */
export const bySeq = (a: Message, b: Message) =>
  (a.seq ?? Infinity) - (b.seq ?? Infinity) || a.createdAt.localeCompare(b.createdAt);

/** REST pages + replica without duplicates: a replica row is newer than REST. */
export function mergeFeed(rest: Message[], local: Message[]): Message[] {
  const m = new Map<string, Message>();
  for (const r of rest) m.set(r.id, r);
  for (const r of local) m.set(r.id, r);
  return [...m.values()].sort(bySeq);
}

const REF = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
type Node = { type?: string; text?: string; content?: Node[] };
const textOf = (n: Node): string => n.text ?? (n.content ?? []).map(textOf).join(' ');

/** Task keys like PLN-123 in message text (without repeats). */
export const taskRefs = (body: unknown): string[] => [
  ...new Set(textOf(body as Node).match(REF) ?? []),
];

/** A reactive proxy is not cloned into IndexedDB — only plain data goes into mutator arguments. */
export const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
export const hue = (name: string) =>
  [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);

// toLocaleTimeString creates an Intl formatter per row (~0.3 ms); a shared one is many times cheaper
export const hhmm = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
