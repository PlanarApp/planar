import { computed } from 'vue';
import { db, useQuery, useSession } from '@planar/web/modules';
import {
  ATTENTION,
  channelOfUrl,
  unread,
  type Channel,
  type Member,
  type Read,
  type UserRow,
} from './model';

interface NotificationRow {
  id: string;
  kind: string;
  url: string | null;
  readAt: string | null;
}
interface SpaceRow {
  id: string;
  name: string;
  rank: string;
}
interface SpaceMember {
  spaceId: string;
  userId: string;
  role: string;
}

/** Каналы, диалоги, участники и мои метки прочтения из реплики. */
export function useChatData() {
  const me = useSession();
  // по запросу на таблицу: отправка сообщения правит только каналы и reads — users/spaces не перечитываются
  const t = <T>(n: string) => useQuery(() => db.table<T>(n).toArray());
  const q = {
    channels: t<Channel>('chatChannels'),
    members: t<Member>('chatMembers'),
    reads: t<Read>('chatReads'),
    users: t<UserRow>('users'),
    spaces: t<SpaceRow>('spaces'),
    spaceMembers: t<SpaceMember>('spaceMembers'),
    notifications: t<NotificationRow>('notifications'),
  };
  const raw = computed(() => {
    const { channels, members, reads, users, spaces, spaceMembers } = q;
    return channels.value &&
      members.value &&
      reads.value &&
      users.value &&
      spaces.value &&
      spaceMembers.value
      ? {
          channels: channels.value,
          members: members.value,
          reads: reads.value,
          users: users.value,
          spaces: spaces.value,
          spaceMembers: spaceMembers.value,
        }
      : undefined;
  });
  const meId = computed(() => me.value?.id ?? '');
  const d = computed(() => raw.value);
  const users = computed(() => new Map((d.value?.users ?? []).map((u) => [u.id, u])));
  const readOf = computed(
    () =>
      new Map(
        (d.value?.reads ?? []).filter((r) => r.userId === meId.value).map((r) => [r.channelId, r]),
      ),
  );
  const unreadOf = (c: Channel) => unread(c, readOf.value.get(c.id));
  // счётчик — непрочитанные уведомления (упоминания и 1:1) по каналам; прочее непрочитанное — только пометка в списке
  const attention = computed(() => {
    const m = new Map<string, string[]>();
    for (const n of q.notifications.value ?? []) {
      const c = !n.readAt && ATTENTION.includes(n.kind) && channelOfUrl(n.url);
      if (c) m.set(c, [...(m.get(c) ?? []), n.id]);
    }
    return m;
  });
  const attentionOf = (c: Channel) => attention.value.get(c.id)?.length ?? 0;
  const total = computed(() => [...attention.value.values()].reduce((s, a) => s + a.length, 0));
  return {
    d,
    meId,
    users,
    readOf,
    unreadOf,
    attention,
    attentionOf,
    total,
    ready: computed(() => !!raw.value),
  };
}
