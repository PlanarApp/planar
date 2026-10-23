<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { X } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { db } from '../sync';
import { StatusIcon, type TaskView } from '../tasks';
import { Button, Input, Select } from '../ui';
import { openTask } from '../views';
import { SIDES, linkTasks, unlinkTasks, useTaskLinks, type LinkSide } from '.';
import { useLive } from './live';

const props = defineProps<{ task: Pick<TaskView, 'id' | 'spaceId'> }>();
const { t } = useI18n();
const links = useTaskLinks(() => props.task.id);

type Item = { id: string; side: LinkSide; key: string; title: string; status?: Row<'statuses'> };
const items = useLive(
  () => links.value ?? [],
  async (ls): Promise<Item[]> => {
    const tasks = await db.table<Row<'tasks'>>('tasks').bulkGet(ls.map((l) => l.otherId));
    const projects = await db
      .table<Row<'projects'>>('projects')
      .bulkGet([...new Set(tasks.map((x) => x?.projectId ?? ''))]);
    const statuses = await db
      .table<Row<'statuses'>>('statuses')
      .bulkGet([...new Set(tasks.map((x) => x?.statusId ?? ''))]);
    return ls.flatMap((l, i) => {
      const x = tasks[i];
      if (!x) return [];
      return {
        id: l.id,
        side: l.side,
        title: x.title,
        key: `${projects.find((p) => p?.id === x.projectId)?.key ?? '?'}-${x.number ?? '…'}`,
        status: statuses.find((s) => s?.id === x.statusId),
      };
    });
  },
);
const groups = computed(() =>
  SIDES.map((side) => ({ side, list: (items.value ?? []).filter((i) => i.side === side) })).filter(
    (g) => g.list.length,
  ),
);

const side = ref<LinkSide>('blocks');
const query = ref('');
const error = ref('');
const sideOptions = computed(() => SIDES.map((s) => ({ value: s, label: t(`links.side.${s}`) })));

const found = useLive(
  () => ({
    q: query.value.trim().toLowerCase(),
    self: props.task.id,
    space: props.task.spaceId,
    linked: new Set((links.value ?? []).map((l) => l.otherId)),
  }),
  async ({ q, self, space, linked }) => {
    if (!q) return [];
    const projects = await db.table<Row<'projects'>>('projects').toArray();
    const out: { id: string; key: string; title: string }[] = [];
    await db
      .table<Row<'tasks'>>('tasks')
      .where('spaceId')
      .equals(space)
      .until(() => out.length >= 20)
      .each((x) => {
        if (x.id === self || linked.has(x.id)) return;
        const key = `${projects.find((p) => p.id === x.projectId)?.key ?? '?'}-${x.number ?? '…'}`;
        if (x.title.toLowerCase().includes(q) || key.toLowerCase().includes(q))
          out.push({ id: x.id, key, title: x.title });
      });
    return out;
  },
);

async function run(f: () => Promise<unknown>) {
  error.value = '';
  try {
    await f();
  } catch (e) {
    error.value =
      (e as { code?: string }).code === 'conflict' ? t('links.conflict') : t('links.failed');
  }
}
const add = (otherId: string) =>
  run(async () => {
    await linkTasks(props.task.id, otherId, side.value);
    query.value = '';
  });
</script>

<template>
  <section :aria-label="t('links.title')">
    <h3 class="mb-1 text-sm font-medium text-fg-muted">{{ t('links.title') }}</h3>
    <div v-for="g in groups" :key="g.side" class="mb-1">
      <h4 class="px-2 text-xs text-fg-subtle">{{ t(`links.side.${g.side}`) }}</h4>
      <ul>
        <li v-for="i in g.list" :key="i.id" class="flex items-center">
          <button
            type="button"
            class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-bg-muted md:min-h-8"
            @click="openTask(i.key)"
          >
            <StatusIcon v-if="i.status" :status="i.status" />
            <span class="text-xs text-fg-subtle">{{ i.key }}</span>
            <span class="flex-1 truncate">{{ i.title }}</span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            :icon="X"
            :aria-label="t('links.remove')"
            data-testid="unlink"
            @click="run(() => unlinkTasks(i.id))"
          />
        </li>
      </ul>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Select v-model="side as string" :options="sideOptions" :label="t('links.add')" />
      <Input
        v-model="query"
        :label="t('links.search')"
        hide-label
        :placeholder="t('links.search')"
      />
    </div>
    <p v-if="error" role="alert" class="px-2 text-sm text-danger">{{ error }}</p>
    <ul v-if="found?.length">
      <li v-for="f in found" :key="f.id">
        <button
          type="button"
          class="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-bg-muted md:min-h-8"
          data-testid="candidate"
          @click="add(f.id)"
        >
          <span class="text-xs text-fg-subtle">{{ f.key }}</span>
          <span class="flex-1 truncate">{{ f.title }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
