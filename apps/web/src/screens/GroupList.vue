<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Settings } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { Button, EmptyState, Input } from '../ui';
import { useSidebarActions } from '../layout/sidebarActions';
import { db, useQuery } from '../sync';
import { useSpaces } from '../tasks';
import { groupUrl } from '../layout/groups';
import type { GroupScope } from '../modules/types';

// "Projects" tab of the space: nested projects as a list with counters
const props = defineProps<{ scope: GroupScope }>();
const { t } = useI18n();
const spaces = useSpaces();
// open tasks per project; tasks — only of open statuses (by the index):
// closed ones are usually most of the table
const stats = useQuery(async () => {
  const openIds = (await db.table<Row<'statuses'>>('statuses').toArray())
    .filter((s) => s.category !== 'done' && s.category !== 'cancelled')
    .map((s) => s.id);
  const tasks = await db.table<Row<'tasks'>>('tasks').where('statusId').anyOf(openIds).toArray();
  const open = new Map<string, number>();
  for (const x of tasks) if (!x.archivedAt) open.set(x.projectId, (open.get(x.projectId) ?? 0) + 1);
  return { open };
});
const rows = computed(() =>
  (spaces.value ?? [])
    .filter((s) => s.id === props.scope.spaceId)
    .flatMap((s) =>
      s.projects.map((p) => ({
        id: p.id,
        to: `/p/${p.id}`,
        name: p.name,
        prefix: p.key,
        meta: [t('groups.list.open', { n: stats.value?.open.get(p.id) ?? 0 })],
      })),
    ),
);
// creation: same as "+" in the side panel
const act = useSidebarActions();
const name = ref('');
async function create() {
  const v = name.value.trim();
  if (!v) return;
  act.start(`new:${props.scope.spaceId}`, v);
  name.value = '';
  await act.commit();
}
const manage = computed(() => groupUrl('space', props.scope.spaceId, 'settings') + '?s=projects');
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-y-auto p-4" data-testid="group-projects">
    <form
      class="mb-3 flex flex-wrap items-end gap-2"
      data-testid="group-create"
      @submit.prevent="create"
    >
      <Input v-model="name" size="sm" :label="t('sidebar.projectName')" class="w-64" />
      <Button type="submit" size="sm" variant="primary" :disabled="!name.trim()">{{
        t('sidebar.newProject')
      }}</Button>
    </form>
    <div class="mb-2 flex items-center">
      <span class="text-sm text-fg-muted">{{ rows.length }}</span>
      <RouterLink :to="manage" class="ml-auto">
        <Button size="sm" variant="ghost" :icon="Settings">{{ t('groups.list.manage') }}</Button>
      </RouterLink>
    </div>
    <EmptyState v-if="spaces && !rows.length" :title="t('groups.list.empty')" />
    <RouterLink
      v-for="r in rows"
      :key="r.id"
      :to="r.to"
      data-testid="group-row"
      class="flex min-h-11 items-center gap-3 border-b border-border px-2 text-sm hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus"
    >
      <span v-if="r.prefix" class="w-16 shrink-0 font-mono text-xs text-fg-muted">{{
        r.prefix
      }}</span>
      <span class="min-w-0 flex-1 truncate font-medium">{{ r.name }}</span>
      <span
        v-for="(m, i) in r.meta"
        :key="i"
        class="hidden shrink-0 text-xs text-fg-muted md:inline"
        >{{ m }}</span
      >
    </RouterLink>
  </div>
</template>
