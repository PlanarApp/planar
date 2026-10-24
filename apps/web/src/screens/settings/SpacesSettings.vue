<script setup lang="ts">
import { ref } from 'vue';
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
const spaces = useQuery(async () =>
  (await db.table<Row<'spaces'>>('spaces').toArray()).sort((a, b) => (a.rank < b.rank ? -1 : 1)),
);
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
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="s in spaces"
        :key="s.id"
        data-testid="space-row"
        class="group flex items-center gap-2 py-1"
      >
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
