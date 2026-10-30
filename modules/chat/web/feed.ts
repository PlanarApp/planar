import { computed, ref, shallowRef } from 'vue';
import { api, db, onReplicaChange, useQuery } from '@planar/web/modules';
import { onScopeDispose } from 'vue';
import { mergeFeed, type Message, type Reaction } from './model';

const LIMIT = 50;
interface Page {
  messages: Message[];
  reactions: Reaction[];
}

const byId = <T extends { id: string }>(a: T[], b: T[]) => [
  ...new Map([...a, ...b].map((x) => [x.id, x])).values(),
];

/**
 * Channel reactions: replica rows (of this session) on top of REST history; removed ones (deletion came via the replica)
 * are hidden, even if the row was only in REST. Feed and thread are the same thing.
 */
export function useChannelReactions(channelId: () => string) {
  // chatReactions has an index only on messageId — we filter by channel
  const local = useQuery(() =>
    db
      .table<Reaction>('chatReactions')
      .filter((r) => r.channelId === channelId())
      .toArray(),
  );
  const gone = shallowRef(new Set<string>());
  const off = onReplicaChange((cs) => {
    const ids = cs.filter((c) => c.entity === 'chatReactions' && !c.row).map((c) => c.id);
    if (ids.length) gone.value = new Set([...gone.value, ...ids]);
  });
  onScopeDispose(off);
  return (rest: Reaction[]) =>
    byId(
      rest.filter((r) => !gone.value.has(r.id)),
      local.value ?? [],
    );
}

/**
 * Channel feed: replica rows (top level) + REST history pages, in memory.
 * The replica is newer than REST; order — by seq.
 */
export function useFeed(channelId: string) {
  const local = useQuery(() =>
    db
      .table<Message>('chatMessages')
      .where('channelId')
      .equals(channelId)
      .filter((m) => !m.parentId)
      .toArray(),
  );
  const merged = useChannelReactions(() => channelId);
  const restMessages = shallowRef<Message[]>([]);
  const restReactions = shallowRef<Reaction[]>([]);
  const loading = ref(false);
  const hasMore = ref(true);
  let started = false;

  const messages = computed(() => mergeFeed(restMessages.value, local.value ?? []));
  const reactions = computed(() => {
    const out = new Map<string, Reaction[]>();
    for (const r of merged(restReactions.value))
      out.set(r.messageId, [...(out.get(r.messageId) ?? []), r]);
    return out;
  });

  /** The first page is the latest; further — before = the minimum seq among those present. */
  async function loadOlder(): Promise<number> {
    if (loading.value || !hasMore.value) return 0;
    loading.value = true;
    try {
      const seqs = messages.value.map((m) => m.seq).filter((s): s is number => s != null);
      // first load — always the latest, even if the replica already has fresh rows
      const before = started && seqs.length ? Math.min(...seqs) : undefined;
      if (before !== undefined && before <= 1) {
        hasMore.value = false;
        return 0;
      }
      const q = `limit=${LIMIT}${before === undefined ? '' : `&before=${before}`}`;
      const page = await api<Page>('GET', `/api/chat/channels/${channelId}/messages?${q}`);
      started = true;
      restMessages.value = byId(page.messages, restMessages.value);
      restReactions.value = byId(page.reactions, restReactions.value);
      if (page.messages.length < LIMIT) hasMore.value = false;
      return page.messages.length;
    } catch {
      return 0; // offline: the replica stays; retry on the next scroll to the top
    } finally {
      loading.value = false;
    }
  }
  /** Whether the message is in the feed; if not — load history pages (≤ maxPages). */
  async function ensure(id: string, maxPages = 20): Promise<boolean> {
    for (let i = 0; i < maxPages; i++) {
      if (messages.value.some((m) => m.id === id)) return true;
      if (!hasMore.value || !(await loadOlder())) break;
    }
    return messages.value.some((m) => m.id === id);
  }
  return {
    messages,
    reactions,
    loadOlder,
    ensure,
    loading,
    hasMore,
    ready: computed(() => !!local.value),
  };
}

/**
 * A message from REST history goes into the replica if it is not there: mutators (reaction, edit, delete)
 * look up the message in the replica (chatMessages without bootstrap). Permissions and outcome — on the server.
 */
export async function toReplica(m: Message): Promise<void> {
  const t = db.table<Message>('chatMessages');
  if (!(await t.get(m.id))) await t.put(JSON.parse(JSON.stringify(m)) as Message);
}
