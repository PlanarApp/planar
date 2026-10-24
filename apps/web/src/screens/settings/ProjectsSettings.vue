<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Badge, Button, Input } from '../../ui';
import { db, mutate, newId, rankBetween, useQuery } from '../../sync';
import RowMenu from './RowMenu.vue';
import SectionHeader from './SectionHeader.vue';
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
const remove = (id: string) => run(() => mutate('project.delete', { id }));
</script>

<template>
  <section class="flex flex-col gap-3">
    <SectionHeader :title="t('settings.projects')" :description="t('settings.projectsDesc')">
      <form v-if="canEdit" class="flex flex-wrap items-start gap-2" @submit.prevent="create">
        <Input v-model="name" :label="t('settings.name')" size="sm" data-testid="project-name" />
        <Input
          v-model="key"
          :label="t('settings.key')"
          size="sm"
          :error="keyError"
          data-testid="project-key"
          @input="key = key.toUpperCase()"
        />
        <Button type="submit" variant="primary" size="sm" class="mt-5">{{
          t('auth.create')
        }}</Button>
      </form>
    </SectionHeader>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="p in projects"
        :key="p.id"
        data-testid="project-row"
        class="group flex h-11 items-center gap-3 md:h-8"
      >
        <Badge>{{ p.key }}</Badge>
        <span class="min-w-0 flex-1 truncate text-sm">{{ p.name }}</span>
        <Badge v-if="p.archivedAt">{{ t('settings.archived') }}</Badge>
        <RowMenu
          v-if="canEdit"
          :items="[
            {
              id: 'archive',
              label: p.archivedAt ? t('settings.unarchive') : t('settings.archive'),
              onSelect: () => archive(p),
            },
            { separator: true },
            {
              id: 'delete',
              label: t('settings.delete'),
              danger: true,
              confirm: {
                title: t('settings.deleteProject'),
                description: p.name,
                confirmLabel: t('settings.delete'),
              },
              onSelect: () => remove(p.id),
            },
          ]"
        />
      </li>
    </ul>
  </section>
</template>
