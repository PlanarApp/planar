<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Badge, Button, Input } from '../../ui';
import { db, mutate, newId, rankBetween, useQuery } from '../../sync';
import ConfirmDialog from './ConfirmDialog.vue';
import { useAction, useAdminSpaces } from './shared';

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const props = defineProps<{ spaceId: string }>();
const { t } = useI18n();
const { error, run } = useAction();
const isAdmin = useAdminSpaces();
const canEdit = computed(() => isAdmin(props.spaceId));
const all = useQuery(() => db.table<Row<'projects'>>('projects').toArray());
const projects = computed(() =>
  (all.value ?? [])
    .filter((p) => p.spaceId === props.spaceId)
    .sort((a, b) => (a.rank < b.rank ? -1 : 1)),
);
const name = ref('');
const key = ref('');
const keyError = ref('');
const del = ref<Row<'projects'> | null>(null);

function create() {
  keyError.value = '';
  if (!name.value.trim()) return;
  if (!KEY_RE.test(key.value)) {
    keyError.value = t('settings.keyInvalid');
    return;
  }
  return run(async () => {
    await mutate('project.create', {
      id: newId(),
      spaceId: props.spaceId,
      name: name.value.trim(),
      key: key.value,
      rank: rankBetween(projects.value.at(-1)?.rank ?? null, null),
    });
    name.value = key.value = '';
  });
}
const archive = (p: Row<'projects'>) =>
  run(() =>
    mutate('project.update', {
      id: p.id,
      archivedAt: p.archivedAt ? null : new Date().toISOString(),
    }),
  );
const remove = () => del.value && run(() => mutate('project.delete', { id: del.value!.id }));
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold">{{ t('settings.projects') }}</h2>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <form v-if="canEdit" class="flex flex-wrap items-start gap-2" @submit.prevent="create">
      <Input v-model="name" :label="t('settings.name')" data-testid="project-name" />
      <Input
        v-model="key"
        :label="t('settings.key')"
        :error="keyError"
        data-testid="project-key"
        @input="key = key.toUpperCase()"
      />
      <Button type="submit" variant="primary" class="mt-6">{{ t('auth.create') }}</Button>
    </form>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="p in projects"
        :key="p.id"
        data-testid="project-row"
        class="flex items-center gap-3 py-2"
      >
        <Badge>{{ p.key }}</Badge>
        <span class="min-w-0 flex-1 truncate">{{ p.name }}</span>
        <Badge v-if="p.archivedAt">{{ t('settings.archived') }}</Badge>
        <template v-if="canEdit">
          <Button size="sm" data-testid="project-archive" @click="archive(p)">{{
            p.archivedAt ? t('settings.unarchive') : t('settings.archive')
          }}</Button>
          <Button size="sm" variant="danger" data-testid="project-delete" @click="del = p">{{
            t('settings.delete')
          }}</Button>
        </template>
      </li>
    </ul>
    <ConfirmDialog
      :open="!!del"
      :title="t('settings.deleteProject')"
      @update:open="(v) => !v && (del = null)"
      @confirm="remove"
    />
  </section>
</template>
