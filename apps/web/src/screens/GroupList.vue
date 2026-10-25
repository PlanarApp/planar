<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Settings } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { Button, EmptyState } from '../ui';
import { db, useQuery } from '../sync';
import { useSpaces } from '../tasks';
import { groupUrl } from '../layout/groups';
import type { GroupScope } from '../modules/types';

// таб «Пространства» / «Проекты» группы: вложенные группы списком со счётчиками
const props = defineProps<{ scope: GroupScope; kind: 'spaces' | 'projects' }>();
const { t } = useI18n();
const spaces = useSpaces();
// открытые задачи по проектам и участники по пространствам — одним проходом по таблицам
const stats = useQuery(async () => {
  const [tasks, statuses, members] = await Promise.all([
    db.table<Row<'tasks'>>('tasks').toArray(),
    db.table<Row<'statuses'>>('statuses').toArray(),
    db.table<Row<'spaceMembers'>>('spaceMembers').toArray(),
  ]);
  const closed = new Set(
    statuses.filter((s) => s.category === 'done' || s.category === 'cancelled').map((s) => s.id),
  );
  const open = new Map<string, number>();
  for (const x of tasks)
    if (!closed.has(x.statusId)) open.set(x.projectId, (open.get(x.projectId) ?? 0) + 1);
  const people = new Map<string, number>();
  for (const m of members) people.set(m.spaceId, (people.get(m.spaceId) ?? 0) + 1);
  return { open, people };
});
const nested = computed(() =>
  (spaces.value ?? []).filter((s) =>
    props.scope.level === 'space' ? s.id === props.scope.spaceId : s.id !== props.scope.rootSpaceId,
  ),
);
const rows = computed(() =>
  props.kind === 'spaces'
    ? nested.value.map((s) => ({
        id: s.id,
        to: groupUrl('space', s.id),
        name: s.name,
        prefix: '',
        meta: [
          t('groups.list.projects', { n: s.projects.length }),
          t('groups.list.members', { n: stats.value?.people.get(s.id) ?? 0 }),
        ],
      }))
    : nested.value.flatMap((s) =>
        s.projects.map((p) => ({
          id: p.id,
          to: groupUrl('project', p.id),
          name: p.name,
          prefix: p.key,
          meta: [
            ...(props.scope.level === 'workspace' ? [s.name] : []),
            t('groups.list.open', { n: stats.value?.open.get(p.id) ?? 0 }),
          ],
        })),
      ),
);
const manage = computed(() =>
  props.kind === 'spaces'
    ? '/w/settings?s=spaces'
    : props.scope.level === 'space'
      ? groupUrl('space', props.scope.spaceId, 'settings') + '?s=projects'
      : '/w/settings?s=spaces',
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-y-auto p-4" :data-testid="`group-${kind}`">
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
