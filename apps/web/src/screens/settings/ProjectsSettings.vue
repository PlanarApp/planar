<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Badge, Button, Input } from '../../ui';
import { db, mutate, newId, rankBetween, useQuery } from '../../sync';
import { defaultModules } from '../../api/defaultModules';
import RowMenu from './RowMenu.vue';
import SectionHeader from './SectionHeader.vue';
import BulkBar, { type BulkAction } from './BulkBar.vue';
import { useAction, useAdminSpaces } from './shared';

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const DEFAULT_STATUSES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as const;
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
    const modules = await defaultModules();
    await mutate('project.create', {
      ...(modules && { modules }),
      id: newId(),
      spaceId: props.spaceId,
      name: name.value.trim(),
      key: key.value,
      rank: rankBetween(projects.value.at(-1)?.rank ?? null, null),
      // statuses belong to a project: the default five (copying from another project — in its settings)
      statusIds: DEFAULT_STATUSES.map(() => newId()),
      statusNames: Object.fromEntries(
        DEFAULT_STATUSES.map((c) => [c, t(`settings.statusDefaults.${c}`)]),
      ),
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
// bulk actions: to archive / from archive / delete selected
const picked = ref(new Set<string>());
const toggle = (id: string) => {
  const s = new Set(picked.value);
  if (!s.delete(id)) s.add(id);
  picked.value = s;
};
const chosen = () => {
  const ps = projects.value.filter((p) => picked.value.has(p.id));
  picked.value = new Set();
  return ps;
};
const setArchived = (on: boolean) => {
  const at = on ? new Date().toISOString() : null;
  for (const p of chosen())
    if (!!p.archivedAt !== on)
      void run(() => mutate('project.update', { id: p.id, archivedAt: at }));
};
const bulk = computed<BulkAction[]>(() => [
  { id: 'archive', label: t('settings.archive'), run: () => setArchived(true) },
  { id: 'unarchive', label: t('settings.unarchive'), run: () => setArchived(false) },
  {
    id: 'delete',
    label: t('settings.delete'),
    danger: true,
    run: () => chosen().forEach((p) => void remove(p.id)),
  },
]);
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
    <BulkBar :count="picked.size" :actions="bulk" @clear="picked = new Set()" />
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="p in projects"
        :key="p.id"
        data-testid="project-row"
        class="group flex h-11 items-center gap-3 md:h-8"
      >
        <input
          v-if="canEdit"
          type="checkbox"
          :aria-label="p.name"
          :checked="picked.has(p.id)"
          data-testid="project-pick"
          @change="toggle(p.id)"
        />
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
