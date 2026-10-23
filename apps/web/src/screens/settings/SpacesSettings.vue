<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Button, Input } from '../../ui';
import { db, mutate, newId, rankBetween, useQuery } from '../../sync';
import ConfirmDialog from './ConfirmDialog.vue';
import { useAction, useAdminSpaces } from './shared';

const { t } = useI18n();
const { error, run } = useAction();
const isAdmin = useAdminSpaces();
const spaces = useQuery(async () =>
  (await db.table<Row<'spaces'>>('spaces').toArray()).sort((a, b) => (a.rank < b.rank ? -1 : 1)),
);
const name = ref('');
const del = ref<Row<'spaces'> | null>(null);
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
const remove = () => del.value && run(() => mutate('space.delete', { id: del.value!.id }));
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold">{{ t('settings.spaces') }}</h2>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <form class="flex items-end gap-2" @submit.prevent="create">
      <Input v-model="name" :label="t('settings.name')" data-testid="space-new" />
      <Button type="submit" variant="primary">{{ t('auth.create') }}</Button>
    </form>
    <ul class="flex flex-col divide-y divide-border">
      <li v-for="s in spaces" :key="s.id" data-testid="space-row" class="flex items-end gap-2 py-2">
        <Input
          :model-value="s.name"
          :label="t('settings.name')"
          hide-label
          :disabled="!canEdit(s.id)"
          class="flex-1"
          @change="(e: Event) => rename(s, (e.target as HTMLInputElement).value)"
        />
        <Button v-if="canEdit(s.id)" size="sm" variant="danger" @click="del = s">{{
          t('settings.delete')
        }}</Button>
      </li>
    </ul>
    <ConfirmDialog
      :open="!!del"
      :title="t('settings.deleteSpace')"
      @update:open="(v) => !v && (del = null)"
      @confirm="remove"
    />
  </section>
</template>
