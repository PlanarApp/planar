<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { CheckCircle2, Circle } from 'lucide-vue-next';
import { EmptyState, Tabs } from '../ui';
import { useAuth } from '../auth/useAuth';
import { mutate } from '../sync';
import { useSpaces } from '../tasks';
import { openTask } from '../views';
import { groupLevels } from '../layout/groups';
import type { GroupScope } from '../modules/types';
import ScopeTasks from '../views/ScopeTasks.vue';
import InboxScreen from '../screens/InboxScreen.vue';
import { useAssignedComments, useMyTasks, useUnreadItems, inGroup } from './queries';

// «Моя работа» группы, как в Plane: сводка, назначенные, комментарии мне, созданные, отслеживаемые, активность
const props = defineProps<{ scope: GroupScope }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { user } = useAuth();
const spaces = useSpaces();
const SUBS = [
  'summary',
  'assigned',
  'comments',
  'mentions',
  'created',
  'watched',
  'activity',
] as const;
const MENTIONS = ['mentioned', 'chat_mention'];
type Sub = (typeof SUBS)[number];
const sub = computed<Sub>(() =>
  SUBS.includes(route.query.w as Sub) ? (route.query.w as Sub) : 'summary',
);
const pick = (w: string) => void router.replace({ query: { ...route.query, w } });

const projectIds = computed(() =>
  groupLevels(props.scope, spaces.value ?? [], '').flatMap((l) => l.projectId ?? []),
);
const inScope = (projectId: string) => projectIds.value.includes(projectId);
const uid = () => user.value?.id;
const assigned = useMyTasks(uid, () => 'assigned');
const created = useMyTasks(uid, () => 'created');
const watched = useMyTasks(uid, () => 'watched');
const comments = useAssignedComments(uid);
const unread = useUnreadItems();
const mine = computed(() => (comments.value ?? []).filter((c) => inScope(c.projectId)));
const openComments = computed(() => mine.value.filter((c) => !c.resolvedAt));
const today = new Date().toISOString().slice(0, 10);
const count = (rows: { projectId: string }[] | undefined) =>
  (rows ?? []).filter((r) => inScope(r.projectId)).length;
const tiles = computed(() => [
  { w: 'assigned', n: count(assigned.value) },
  {
    w: 'assigned',
    key: 'overdue',
    n: (assigned.value ?? []).filter((r) => inScope(r.projectId) && r.dueDate && r.dueDate < today)
      .length,
  },
  { w: 'comments', n: openComments.value.length },
  {
    w: 'mentions',
    n: (unread.value ?? []).filter((n) => MENTIONS.includes(n.kind) && inGroup(n, props.scope))
      .length,
  },
  { w: 'created', n: count(created.value) },
  { w: 'watched', n: count(watched.value) },
  {
    w: 'activity',
    key: 'unread',
    n: (unread.value ?? []).filter((n) => inGroup(n, props.scope)).length,
  },
]);
const textOf = (body: unknown): string => {
  const out: string[] = [];
  const walk = (n: { text?: string; content?: unknown[] }) => {
    if (n.text) out.push(n.text);
    for (const c of n.content ?? []) walk(c as typeof n);
  };
  walk(body as { content?: unknown[] });
  return out.join(' ');
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="my-work">
    <div class="shrink-0 border-b border-border px-2 py-1">
      <Tabs
        :model-value="sub"
        :label="t('work.title')"
        :items="SUBS.map((s) => ({ value: s, label: t(`work.${s}`) }))"
        @update:model-value="pick"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="sub === 'summary'" class="flex flex-col gap-4 p-4">
        <div class="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <button
            v-for="x in tiles"
            :key="x.key ?? x.w"
            type="button"
            class="flex flex-col items-start gap-1 rounded-lg border border-border p-3 text-left hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus"
            :data-testid="`tile-${x.key ?? x.w}`"
            @click="pick(x.w)"
          >
            <span class="text-2xl font-semibold">{{ x.n }}</span>
            <span class="text-xs text-fg-muted">{{ t(`work.tile.${x.key ?? x.w}`) }}</span>
          </button>
        </div>
      </div>
      <!-- вид таба Задачи (Список/Доска) с закреплённым Me Mode -->
      <ScopeTasks
        v-else-if="sub === 'assigned' || sub === 'created' || sub === 'watched'"
        :key="sub"
        :me="sub"
        :space-id="scope.level === 'space' ? scope.spaceId : undefined"
        :project-id="scope.projectId ?? undefined"
        :root-space-id="scope.rootSpaceId"
      />
      <div v-else-if="sub === 'comments'" class="flex flex-col gap-1 p-4">
        <EmptyState v-if="comments && !mine.length" :title="t('work.noComments')" />
        <div
          v-for="c in mine"
          :key="c.id"
          data-testid="work-comment"
          class="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-bg-muted"
        >
          <button
            type="button"
            :aria-label="t('task.resolved')"
            :aria-pressed="!!c.resolvedAt"
            class="shrink-0 text-fg-muted hover:text-fg"
            @click="mutate('comment.resolve', { id: c.id, resolved: !c.resolvedAt })"
          >
            <CheckCircle2 v-if="c.resolvedAt" :size="16" class="text-success" />
            <Circle v-else :size="16" />
          </button>
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
            @click="openTask(c.key)"
          >
            <span class="shrink-0 text-xs text-fg-subtle">{{ c.key }}</span>
            <span :class="['truncate', c.resolvedAt && 'text-fg-muted line-through']">{{
              textOf(c.body)
            }}</span>
            <span class="ml-auto hidden truncate text-xs text-fg-subtle md:inline">{{
              c.title
            }}</span>
          </button>
        </div>
      </div>
      <InboxScreen v-else-if="sub === 'mentions'" :scope="scope" :kinds="MENTIONS" />
      <InboxScreen v-else :scope="scope" />
    </div>
  </div>
</template>
