<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Dialog, EmptyState, Input, Select, useRouter } from '@planar/web/modules';
import { mutate, newId, rankBetween, tr, useBoards, useSpaces } from './data';

const router = useRouter();
const boards = useBoards();
const spaces = useSpaces();
const open = ref(false);
const name = ref('');
const where = ref('');

const groups = computed(() => {
  const all = boards.value ?? [];
  return (spaces.value ?? [])
    .map((s) => ({ id: s.id, title: s.name, items: all.filter((b) => b.spaceId === s.id) }))
    .filter((g) => g.items.length);
});
const personal = ref(false);
const whereOpts = computed(() => (spaces.value ?? []).map((s) => ({ value: s.id, label: s.name })));

async function create() {
  const spaceId = where.value || whereOpts.value[0]?.value;
  if (!name.value.trim() || !spaceId) return;
  const last = (boards.value ?? []).at(-1)?.rank ?? null;
  const id = newId();
  await mutate('dashboards.create', {
    id,
    name: name.value.trim(),
    rank: rankBetween(last, null),
    spaceId,
    ...(personal.value ? { personal: true } : {}),
  });
  open.value = false;
  name.value = '';
  void router.push(`/m/dashboards/${id}`);
}
</script>

<template>
  <section class="page">
    <header class="head">
      <h2>{{ tr('title') }}</h2>
      <Button variant="primary" data-test="create" @click="open = true">{{ tr('create') }}</Button>
    </header>
    <EmptyState v-if="boards && !groups.length" :title="tr('none')" />
    <div v-for="g in groups" :key="g.id" class="group">
      <h3>{{ g.title }}</h3>
      <ul>
        <li v-for="b in g.items" :key="b.id">
          <a
            :href="`/m/dashboards/${b.id}`"
            data-test="board"
            @click.prevent="router.push(`/m/dashboards/${b.id}`)"
            >{{ b.name }}</a
          >
        </li>
      </ul>
    </div>
    <Dialog v-model:open="open" :title="tr('create')" size="sm">
      <div class="form">
        <Input v-model="name" :label="tr('name')" />
        <Select v-model="where" :label="tr('space')" :options="whereOpts" />
        <label
          ><input v-model="personal" type="checkbox" data-test="personal" />
          {{ tr('personal') }}</label
        >
      </div>
      <template #footer>
        <Button @click="open = false">{{ tr('cancel') }}</Button>
        <Button variant="primary" data-test="save" @click="create">{{ tr('save') }}</Button>
      </template>
    </Dialog>
  </section>
</template>

<style scoped>
.page {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
h2 {
  flex: 1;
  margin: 0;
  font-size: var(--text-xl);
}
h3 {
  margin: 0 0 4px;
  font-size: var(--text-sm);
  color: var(--color-fg-muted);
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
li a {
  display: block;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  color: var(--color-fg);
  text-decoration: none;
}
li a:hover {
  background: var(--color-bg-muted);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
