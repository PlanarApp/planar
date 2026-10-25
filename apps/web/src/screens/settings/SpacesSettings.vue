<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRootSpaceId } from '../../tasks';
import BulkBar, { type BulkAction } from './BulkBar.vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Button, Input } from '../../ui';
import { db, mutate, newId, rankBetween, useQuery } from '../../sync';
import RowMenu from './RowMenu.vue';
import SectionHeader from './SectionHeader.vue';
import { useAction, useAdminSpaces } from './shared';

const { t } = useI18n();
const { error, run } = useAction();
const isAdmin = useAdminSpaces();
const rootId = useRootSpaceId();
// корневое «Общее» — это Воркспейс, не пространство списка
const spaces = useQuery(async () =>
  (await db.table<Row<'spaces'>>('spaces').toArray()).sort((a, b) => (a.rank < b.rank ? -1 : 1)),
);
const listed = computed(() => (spaces.value ?? []).filter((s) => s.id !== rootId.value));
// массовые действия: удалить выбранные (непустые сервер не удалит — ошибка в строке сообщения)
const picked = ref(new Set<string>());
const toggle = (id: string) => {
  const s = new Set(picked.value);
  if (!s.delete(id)) s.add(id);
  picked.value = s;
};
const bulk = computed<BulkAction[]>(() => [
  {
    id: 'delete',
    label: t('settings.delete'),
    danger: true,
    run: () => {
      const ids = [...picked.value];
      picked.value = new Set();
      for (const id of ids) void remove(id);
    },
  },
]);
const name = ref('');
const canEdit = (id: string) => isAdmin(id);

const create = () =>
  name.value.trim() &&
  run(async () => {
    const last = spaces.value?.at(-1)?.rank ?? null;
    await mutate('space.create', {
      id: newId(),
      name: name.value.trim(),
      rank: rankBetween(last, null),
      memberId: newId(),
      statusIds: Array.from({ length: 5 }, newId),
      statusNames: Object.fromEntries(
        ['backlog', 'todo', 'in_progress', 'done', 'cancelled'].map((c) => [
          c,
          t(`settings.statusDefaults.${c}`),
        ]),
      ),
    });
    name.value = '';
  });
const rename = (s: Row<'spaces'>, v: string) =>
  v.trim() && v !== s.name && run(() => mutate('space.update', { id: s.id, name: v.trim() }));
const remove = (id: string) => run(() => mutate('space.delete', { id }));
</script>

<template>
  <section class="flex flex-col gap-3">
    <SectionHeader :title="t('settings.spaces')" :description="t('settings.spacesDesc')">
      <form class="flex items-end gap-2" @submit.prevent="create">
        <Input v-model="name" :label="t('settings.name')" size="sm" data-testid="space-new" />
        <Button type="submit" variant="primary" size="sm">{{ t('auth.create') }}</Button>
      </form>
    </SectionHeader>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <BulkBar :count="picked.size" :actions="bulk" @clear="picked = new Set()" />
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="s in listed"
        :key="s.id"
        data-testid="space-row"
        class="group flex items-center gap-2 py-1"
      >
        <input
          v-if="canEdit(s.id)"
          type="checkbox"
          :aria-label="s.name"
          :checked="picked.has(s.id)"
          data-testid="space-pick"
          @change="toggle(s.id)"
        />
        <Input
          :model-value="s.name"
          :label="t('settings.name')"
          hide-label
          :disabled="!canEdit(s.id)"
          class="flex-1"
          @change="(e: Event) => rename(s, (e.target as HTMLInputElement).value)"
        />
        <RowMenu
          v-if="canEdit(s.id)"
          :items="[
            {
              id: 'delete',
              label: t('settings.delete'),
              danger: true,
              confirm: {
                title: t('settings.deleteSpace'),
                description: s.name,
                confirmLabel: t('settings.delete'),
              },
              onSelect: () => remove(s.id),
            },
          ]"
        />
      </li>
    </ul>
  </section>
</template>
