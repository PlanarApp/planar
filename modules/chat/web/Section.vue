<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { Plus } from 'lucide-vue-next';
import { Button, Input, mutate, newId } from '@planar/web/modules';
import { useChatData } from './data';
import { byName, dmTitle, findDm, type Channel } from './model';
import { useTexts } from './text';

const tx = useTexts();
const route = useRoute();
const router = useRouter();
const { d, meId, users, unreadOf } = useChatData();
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
    .filter((g) => g.items.length || g.canCreate);
});
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
  <section data-testid="chat-section" class="mt-2">
    <h2 class="mb-1 px-2 text-xs font-medium text-fg-muted">{{ tx('chat') }}</h2>
    <div v-for="g in groups" :key="g.s.id" class="mb-1">
      <div class="flex items-center justify-between px-2 text-xs text-fg-subtle">
        <span class="truncate">{{ g.s.name }}</span>
        <button
          v-if="g.canCreate"
          type="button"
          :aria-label="tx('newChannel')"
          data-testid="chat-add-channel"
          class="rounded-sm p-0.5 hover:bg-bg-muted"
          @click="addIn = addIn === g.s.id ? '' : g.s.id"
        >
          <Plus :size="14" />
        </button>
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
          'flex h-8 items-center justify-between rounded-md px-2 text-base hover:bg-bg-muted',
          current === c.id && 'bg-bg-muted font-medium',
        ]"
      >
        <span class="truncate"># {{ title(c) }}</span>
        <span
          v-if="unreadOf(c) > 0"
          data-testid="chat-unread"
          class="ml-2 rounded-full bg-accent px-1.5 text-xs text-accent-fg"
          >{{ unreadOf(c) }}</span
        >
      </RouterLink>
    </div>

    <div class="mb-1">
      <div class="flex items-center justify-between px-2 text-xs text-fg-subtle">
        <span>{{ tx('dms') }}</span>
        <button
          type="button"
          :aria-label="tx('newDm')"
          data-testid="chat-add-dm"
          class="rounded-sm p-0.5 hover:bg-bg-muted"
          @click="picking = !picking"
        >
          <Plus :size="14" />
        </button>
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
          'flex h-8 items-center justify-between rounded-md px-2 text-base hover:bg-bg-muted',
          current === x.c.id && 'bg-bg-muted font-medium',
        ]"
      >
        <span class="truncate">{{ x.title }}</span>
        <span
          v-if="unreadOf(x.c) > 0"
          data-testid="chat-unread"
          class="ml-2 rounded-full bg-accent px-1.5 text-xs text-accent-fg"
          >{{ unreadOf(x.c) }}</span
        >
      </RouterLink>
    </div>
  </section>
</template>
