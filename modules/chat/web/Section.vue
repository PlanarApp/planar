<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ChevronRight, Plus } from 'lucide-vue-next';
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
    <h2>
      <button
        type="button"
        :aria-expanded="!folded"
        class="flex h-7 w-full items-center gap-1 rounded-md px-2 text-sm text-fg outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
        @click="fold"
      >
        <ChevronRight :size="12" :class="['shrink-0', !folded && 'rotate-90']" />{{ tx('chat') }}
      </button>
    </h2>
    <template v-if="!folded">
      <form
        v-if="d && !groups.length && addIn"
        class="flex gap-1 px-2 py-1"
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
      <div v-if="d && !groups.length" class="flex h-7 items-center px-2 text-xs text-fg-muted">
        {{ tx('noChannels') }}
        <IconButton
          v-if="firstCreate"
          :icon="Plus"
          :label="tx('newChannel')"
          size="sm"
          data-testid="chat-add-channel"
          class="ml-auto"
          @click="addIn = addIn ? '' : firstCreate.id"
        />
      </div>
      <div v-for="g in groups" :key="g.s.id">
        <div
          v-if="groups.length > 1 || g.canCreate"
          class="flex h-7 items-center px-2 text-xs text-fg-muted"
        >
          <span v-if="groups.length > 1" class="truncate">{{ g.s.name }}</span>
          <IconButton
            v-if="g.canCreate"
            :icon="Plus"
            :label="tx('newChannel')"
            size="sm"
            data-testid="chat-add-channel"
            class="ml-auto"
            @click="addIn = addIn === g.s.id ? '' : g.s.id"
          />
        </div>
        <form v-if="addIn === g.s.id" class="flex gap-1 px-2 py-1" @submit.prevent="addChannel">
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
          :class="[
            'flex h-7 items-center justify-between rounded-md px-2 text-sm hover:bg-bg-muted',
            current === c.id && 'bg-bg-muted font-medium',
          ]"
        >
          <span class="truncate"># {{ title(c) }}</span>
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
        <div class="flex h-7 items-center justify-between px-2 text-xs text-fg-muted">
          <span>{{ tx('dms') }}</span>
          <IconButton
            :icon="Plus"
            :label="tx('newDm')"
            size="sm"
            data-testid="chat-add-dm"
            @click="picking = !picking"
          />
        </div>
        <form v-if="picking" class="px-2 py-1" @submit.prevent="openDm">
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
          :class="[
            'flex h-7 items-center justify-between rounded-md px-2 text-sm hover:bg-bg-muted',
            current === x.c.id && 'bg-bg-muted font-medium',
          ]"
        >
          <span class="truncate">{{ x.title }}</span>
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
