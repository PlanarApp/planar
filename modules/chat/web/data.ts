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
  const raw = useQuery(async () => {
    const t = <T>(n: string) => db.table<T>(n).toArray();
    const [channels, members, reads, users, spaces, spaceMembers] = await Promise.all([
      t<Channel>('chatChannels'),
      t<Member>('chatMembers'),
      t<Read>('chatReads'),
      t<UserRow>('users'),
      t<SpaceRow>('spaces'),
      t<SpaceMember>('spaceMembers'),
    ]);
    return { channels, members, reads, users, spaces, spaceMembers };
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
