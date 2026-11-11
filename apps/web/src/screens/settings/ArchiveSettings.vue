<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import type { Row } from '@planar/shared';
import { Button } from '../../ui';
import { db, mutate, useQuery } from '../../sync';
import { enabledForProject } from '../../modules/registry';
import { restoreTask, useProjectAdmin } from '../../tasks';
import SectionHeader from './SectionHeader.vue';
import { useAction } from './shared';

// PLNRAPP-154: the project's archived tasks, documents and chats; open — anyone, restore — an admin
const ARCHIVE_DAYS = 30; // = ARCHIVE_DAYS of @planar/server-kit (the purge jobs)
const props = defineProps<{ projectId: string }>();
defineOptions({ inheritAttrs: false }); // SettingsScreen also passes spaceId / level
const { t, locale } = useI18n();
const { error, run } = useAction();
const admin = useProjectAdmin();
const router = useRouter();

type Archived = { id: string; parentId?: string | null; archivedAt: string | null };
type Item = {
  id: string;
  title: string;
  by: string | null;
  at: string;
  to: string;
  restore: () => Promise<void>;
};
const has = (table: string) => db.tables.some((x) => x.name === table);
/** the top of each archived subtree: its children come back with it */
const tops = <T extends Archived>(rows: T[]) => {
  const ids = new Set(rows.filter((r) => r.archivedAt).map((r) => r.id));
  return rows.filter((r) => r.archivedAt && !(r.parentId && ids.has(r.parentId)));
};
const newest = (a: Item, b: Item) => b.at.localeCompare(a.at);

const data = useQuery(async () => {
  const pid = props.projectId;
  const project = await db.table<Row<'projects'>>('projects').get(pid);
  const tasks = await db.table<Row<'tasks'>>('tasks').where('projectId').equals(pid).toArray();
  const pages = has('docsPages')
    ? (await db.table('docsPages').toArray()).filter((p) => p.projectId === pid)
    : [];
  const chats = has('chatChannels')
    ? (await db.table('chatChannels').toArray()).filter((c) => c.projectId === pid && c.archivedAt)
    : [];
  const users = new Map(
    (await db.table<Row<'users'>>('users').toArray()).map((u) => [u.id, u.name]),
  );
  return { project, tasks, pages, chats, users };
});

const groups = computed(() => {
  const d = data.value;
  if (!d) return [];
  const name = (id: string | null) => (id && d.users.get(id)) || '—';
  const key = d.project?.key ?? '?';
  return [
    {
      id: 'tasks',
      items: tops(d.tasks)
        .map((x) => ({
          id: x.id,
          title: x.title,
          by: name(x.archivedBy),
          at: x.archivedAt!,
          to: `/t/${key}-${x.number}`,
          restore: () => restoreTask(x.id),
        }))
        .sort(newest),
      on: true,
    },
    {
      id: 'docs',
      items: tops(d.pages as (Archived & { title: string; archivedBy: string | null })[])
        .map((x) => ({
          id: x.id,
          title: x.title || t('archive.untitled'),
          by: name(x.archivedBy),
          at: x.archivedAt!,
          to: `/m/docs/${x.id}`,
          restore: () => mutate('docs.page.restore', { id: x.id }),
        }))
        .sort(newest),
      on: has('docsPages') && enabledForProject('docs', props.projectId),
    },
    {
      id: 'chats',
      items: (
        d.chats as {
          id: string;
          name: string | null;
          archivedAt: string;
          archivedBy: string | null;
        }[]
      )
        .map((x) => ({
          id: x.id,
          title: x.name ?? '',
          by: name(x.archivedBy),
          at: x.archivedAt,
          to: `/m/chat/c/${x.id}`,
          restore: () => mutate('chat.channel.update', { id: x.id, archivedAt: null }),
        }))
        .sort(newest),
      on: has('chatChannels') && enabledForProject('chat', props.projectId),
    },
  ].filter((g) => g.on) as { id: string; items: Item[] }[];
});
const canRestore = computed(
  () => !!data.value?.project && admin(data.value.project.spaceId, props.projectId),
);
const when = (iso: string) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<template>
  <section class="flex flex-col gap-4">
    <SectionHeader :title="t('settings.projectArchive')" />
    <p
      role="note"
      data-testid="archive-retention"
      class="rounded-md border border-border bg-bg-muted px-3 py-2 text-sm"
    >
      {{ t('archive.retention', { n: ARCHIVE_DAYS }) }}
      <template v-if="!canRestore"> {{ t('archive.adminOnly') }}</template>
    </p>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <div
      v-for="g in groups"
      :key="g.id"
      class="flex flex-col gap-1"
      :data-testid="`archive-${g.id}`"
    >
      <h3 class="text-sm font-medium">{{ t(`archive.${g.id}`) }}</h3>
      <p v-if="!g.items.length" class="text-sm text-fg-subtle">{{ t('archive.empty') }}</p>
      <ul v-else class="flex flex-col divide-y divide-border">
        <li
          v-for="it in g.items"
          :key="it.id"
          data-testid="archive-row"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
        >
          <span class="min-w-0 flex-1 truncate text-sm">{{ it.title }}</span>
          <span class="text-xs text-fg-subtle">{{
            t('archive.by', { who: it.by, when: when(it.at) })
          }}</span>
          <Button size="sm" variant="ghost" @click="router.push(it.to)">{{
            t('archive.open')
          }}</Button>
          <Button
            v-if="canRestore"
            size="sm"
            data-testid="archive-restore"
            @click="run(it.restore)"
            >{{ t('archive.restore') }}</Button
          >
        </li>
      </ul>
    </div>
  </section>
</template>
