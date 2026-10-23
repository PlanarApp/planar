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

/** Непрочитанные канала: lastSeq − lastReadSeq; muted — без счётчика. */
export const unread = (c: Channel, r?: Read): number =>
  r?.muted ? 0 : Math.max(0, c.lastSeq - (r?.lastReadSeq ?? 0));

export const byName = (a: string, b: string) => a.localeCompare(b);

/** Имя диалога — участники, кроме меня. */
export function dmTitle(c: Channel, members: Member[], users: Map<string, UserRow>, me: string) {
  return members
    .filter((m) => m.channelId === c.id && m.userId !== me)
    .map((m) => users.get(m.userId)?.name ?? '?')
    .sort(byName)
    .join(', ');
}

/** Диалог с точно таким составом (включая меня), если есть. */
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

/** Порядок ленты: по seq; без seq (и свои неподтверждённые) — в конце. */
export const bySeq = (a: Message, b: Message) =>
  (a.seq ?? Infinity) - (b.seq ?? Infinity) || a.createdAt.localeCompare(b.createdAt);

/** REST-страницы + реплика без дублей: строка реплики новее REST. */
export function mergeFeed(rest: Message[], local: Message[]): Message[] {
  const m = new Map<string, Message>();
  for (const r of rest) m.set(r.id, r);
  for (const r of local) m.set(r.id, r);
  return [...m.values()].sort(bySeq);
}

const REF = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
type Node = { type?: string; text?: string; content?: Node[] };
const textOf = (n: Node): string => n.text ?? (n.content ?? []).map(textOf).join(' ');

/** Ключи задач вида PLN-123 в тексте сообщения (без повторов). */
export const taskRefs = (body: unknown): string[] => [
  ...new Set(textOf(body as Node).match(REF) ?? []),
];

/** Реактивный прокси не клонируется в IndexedDB — в аргументы мутаторов только простые данные. */
export const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
