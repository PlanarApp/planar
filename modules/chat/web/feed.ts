import { computed, ref, shallowRef } from 'vue';
import { api, db, useQuery } from '@planar/web/modules';
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
 * Лента канала: строки реплики (верхний уровень) + страницы истории REST, в памяти.
 * Реплика новее REST; порядок — по seq.
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
  const localReactions = useQuery(() =>
    db.table<Reaction>('chatReactions').where('channelId').equals(channelId).toArray(),
  );
  const restMessages = shallowRef<Message[]>([]);
  const restReactions = shallowRef<Reaction[]>([]);
  const loading = ref(false);
  const hasMore = ref(true);
  let started = false;

  const messages = computed(() => mergeFeed(restMessages.value, local.value ?? []));
  const reactions = computed(() => {
    const out = new Map<string, Reaction[]>();
    for (const r of byId(restReactions.value, localReactions.value ?? []))
      out.set(r.messageId, [...(out.get(r.messageId) ?? []), r]);
    return out;
  });

  /** Первая страница — последние; дальше — before = минимальный seq из имеющихся. */
  async function loadOlder(): Promise<number> {
    if (loading.value || !hasMore.value) return 0;
    loading.value = true;
    try {
      const seqs = messages.value.map((m) => m.seq).filter((s): s is number => s != null);
      // первая загрузка — всегда последние, даже если в реплике уже есть свежие строки
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
      return 0; // офлайн: останется реплика; повтор — при следующей прокрутке к верху
    } finally {
      loading.value = false;
    }
  }
  return { messages, reactions, loadOlder, loading, hasMore, ready: computed(() => !!local.value) };
}
