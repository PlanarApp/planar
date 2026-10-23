import { computed } from 'vue';
import { db, useQuery, useSession } from '@planar/web/modules';
import { unread, type Channel, type Member, type Read, type UserRow } from './model';

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
  const total = computed(() => (d.value?.channels ?? []).reduce((s, c) => s + unreadOf(c), 0));
  return { d, meId, users, readOf, unreadOf, total, ready: computed(() => !!raw.value) };
}
