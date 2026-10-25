<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ChevronRight, Hash, Plus, User } from 'lucide-vue-next';
import { Badge, Button, IconButton, Input, mutate, newId } from '@planar/web/modules';
import { useChatData } from './data';
import { byName, dmTitle, findDm, type Channel } from './model';
import { useTexts } from './text';

const tx = useTexts();
const route = useRoute();
const router = useRouter();
const { d, meId, users, unreadOf } = useChatData();
// свёрнутость секции — своё состояние, не часть интерфейса ядра
const KEY = 'planar.sidebar.chat';
const folded = ref(false);
try {
  folded.value = localStorage.getItem(KEY) === '1';
} catch {
  /* без хранилища — до перезагрузки */
}
const fold = () => {
  folded.value = !folded.value;
  try {
    localStorage.setItem(KEY, folded.value ? '1' : '0');
  } catch {
    /* см. выше */
  }
};
const current = computed(() => route.params.channelId as string | undefined);

const groups = computed(() => {
  const x = d.value;
  if (!x) return [];
  return [...x.spaces]
    .sort((a, b) => (a.rank < b.rank ? -1 : 1))
    .map((s) => ({
      s,
      canCreate: x.spaceMembers.some(
        (m) => m.spaceId === s.id && m.userId === meId.value && m.role !== 'guest',
      ),
      items: x.channels
        .filter((c) => c.spaceId === s.id && !c.archivedAt)
        .sort((a, b) => byName(a.name ?? '', b.name ?? '')),
    }))
    .filter((g) => g.items.length);
});
// без каналов: одна кнопка «создать» в первом пространстве, где можно
const firstCreate = computed(
  () =>
    d.value &&
    [...d.value.spaces]
      .sort((a, b) => (a.rank < b.rank ? -1 : 1))
      .find((s) =>
        d.value!.spaceMembers.some(
          (m) => m.spaceId === s.id && m.userId === meId.value && m.role !== 'guest',
        ),
      ),
);
const dms = computed(() => {
  const x = d.value;
  if (!x) return [];
  return x.channels
    .filter((c) => c.kind === 'dm' && !c.archivedAt)
    .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt))
    .map((c) => ({ c, title: dmTitle(c, x.members, users.value, meId.value) }));
});
const title = (c: Channel) => c.name ?? '';
// «+» канал: в строке заголовка «Чат» — когда пространство одно (или каналов нет); при нескольких — в строке пространства
const headerSpace = computed(() =>
  groups.value.length > 1
    ? undefined
    : groups.value.length
      ? groups.value[0].canCreate
        ? groups.value[0].s
        : undefined
      : firstCreate.value || undefined,
);
const hoverPlus = 'md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100';
const row =
  'flex h-7 items-center justify-between gap-1.5 rounded-md pl-7 pr-2 text-sm hover:bg-bg-muted';

// + канал: имя в строке под заголовком пространства
const addIn = ref('');
const name = ref('');
async function addChannel() {
  const n = name.value.trim();
  if (!n || !addIn.value) return;
  const id = newId();
  await mutate('chat.channel.create', { id, spaceId: addIn.value, name: n });
  addIn.value = name.value = '';
  void router.push(`/m/chat/c/${id}`);
}

// + диалог: выбор 1–7 людей; тот же состав — открыть существующий
const picking = ref(false);
const picked = ref<string[]>([]);
const people = computed(() =>
  [...users.value.values()]
    .filter((u) => u.id !== meId.value && !u.deactivatedAt)
    .sort((a, b) => byName(a.name, b.name)),
);
const toggle = (id: string) =>
  (picked.value = picked.value.includes(id)
    ? picked.value.filter((x) => x !== id)
    : picked.value.length < 7
      ? [...picked.value, id]
      : picked.value);
async function openDm() {
  const ids = [meId.value, ...picked.value];
  if (picked.value.length < 1) return;
  const x = d.value!;
  let id = findDm(x.channels, x.members, ids)?.id;
  if (!id) {
    id = newId();
    await mutate('chat.dm.create', {
      id,
      members: ids.map((userId) => ({ id: newId(), userId })),
    });
  }
  picking.value = false;
  picked.value = [];
  void router.push(`/m/chat/c/${id}`);
}
const link = (id: string) => `/m/chat/c/${id}`;
</script>

<template>
  <section data-testid="chat-section">
    <h2 class="group flex items-center">
      <button
        type="button"
        :aria-expanded="!folded"
        class="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-xs font-medium uppercase text-fg-muted outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
        @click="fold"
      >
        <ChevronRight
          :size="12"
          :class="['shrink-0 transition-transform', !folded && 'rotate-90']"
        />{{ tx('chat') }}
      </button>
      <IconButton
        v-if="headerSpace"
        :icon="Plus"
        :label="tx('newChannel')"
        size="sm"
        data-testid="chat-add-channel"
        :class="hoverPlus"
        @click="addIn = addIn === headerSpace.id ? '' : headerSpace.id"
      />
    </h2>
    <template v-if="!folded">
      <form
        v-if="d && !groups.length && addIn"
        class="flex gap-1 py-1 pl-7 pr-2"
        @submit.prevent="addChannel"
      >
        <Input
          v-model="name"
          :label="tx('channelName')"
          hide-label
          :placeholder="tx('channelName')"
        />
        <Button type="submit" size="sm" variant="primary">{{ tx('create') }}</Button>
      </form>
      <div v-if="d && !groups.length" class="flex h-7 items-center pl-7 pr-2 text-sm text-fg-muted">
        {{ tx('noChannels') }}
      </div>
      <div v-for="g in groups" :key="g.s.id">
        <div
          v-if="groups.length > 1"
          class="group flex h-7 items-center px-2 text-sm font-medium text-fg"
        >
          <span class="truncate">{{ g.s.name }}</span>
          <IconButton
            v-if="g.canCreate"
            :icon="Plus"
            :label="tx('newChannel')"
            size="sm"
            data-testid="chat-add-channel"
            :class="['ml-auto', hoverPlus]"
            @click="addIn = addIn === g.s.id ? '' : g.s.id"
          />
        </div>
        <form
          v-if="addIn === g.s.id"
          class="flex gap-1 py-1 pl-7 pr-2"
          @submit.prevent="addChannel"
        >
          <Input
            v-model="name"
            :label="tx('channelName')"
            hide-label
            :placeholder="tx('channelName')"
          />
          <Button type="submit" size="sm" variant="primary">{{ tx('create') }}</Button>
        </form>
        <RouterLink
          v-for="c in g.items"
          :key="c.id"
          :to="link(c.id)"
          data-testid="chat-channel"
          :aria-current="current === c.id ? 'page' : undefined"
          :class="[row, current === c.id && 'bg-bg-muted font-medium']"
        >
          <span class="flex min-w-0 flex-1 items-center gap-1.5"
            ><Hash :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" /><span
              class="truncate"
              >{{ title(c) }}</span
            ></span
          >
          <Badge
            v-if="unreadOf(c) > 0"
            data-testid="chat-unread"
            variant="solid"
            color="var(--color-accent)"
            class="ml-2 text-accent-fg!"
            >{{ unreadOf(c) }}</Badge
          >
        </RouterLink>
      </div>

      <div>
        <div class="group flex h-7 items-center justify-between px-2 text-sm font-medium text-fg">
          <span>{{ tx('dms') }}</span>
          <IconButton
            :icon="Plus"
            :label="tx('newDm')"
            size="sm"
            :class="hoverPlus"
            data-testid="chat-add-dm"
            @click="picking = !picking"
          />
        </div>
        <form v-if="picking" class="py-1 pl-7 pr-2" @submit.prevent="openDm">
          <label v-for="u in people" :key="u.id" class="flex items-center gap-2 py-0.5 text-sm">
            <input
              type="checkbox"
              :checked="picked.includes(u.id)"
              :data-testid="`chat-pick-${u.id}`"
              @change="toggle(u.id)"
            />
            {{ u.name }}
          </label>
          <Button type="submit" size="sm" variant="primary" :disabled="!picked.length">{{
            tx('create')
          }}</Button>
        </form>
        <RouterLink
          v-for="x in dms"
          :key="x.c.id"
          :to="link(x.c.id)"
          data-testid="chat-dm"
          :aria-current="current === x.c.id ? 'page' : undefined"
          :class="[row, current === x.c.id && 'bg-bg-muted font-medium']"
        >
          <span class="flex min-w-0 flex-1 items-center gap-1.5"
            ><User :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" /><span
              class="truncate"
              >{{ x.title }}</span
            ></span
          >
          <Badge
            v-if="unreadOf(x.c) > 0"
            data-testid="chat-unread"
            variant="solid"
            color="var(--color-accent)"
            class="ml-2 text-accent-fg!"
            >{{ unreadOf(x.c) }}</Badge
          >
        </RouterLink>
      </div>
    </template>
  </section>
</template>
