<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  AtSign,
  CheckCircle2,
  Circle,
  Eye,
  History,
  LayoutDashboard,
  MessageSquare,
  SquarePen,
  Sun,
  UserRound,
} from 'lucide-vue-next';
import { EmptyState, Tabs } from '../ui';
import { useAuth } from '../auth/useAuth';
import { mutate } from '../sync';
import { useSpaces } from '../tasks';
import { openTask } from '../views';
import { groupLevels } from '../layout/groups';
import type { GroupScope } from '../modules/types';
import ScopeTasks from '../views/ScopeTasks.vue';
import InboxScreen from '../screens/InboxScreen.vue';
import { useUsers } from '../task/queries';
import { useAssignedComments, useMyTasks, useUnreadItems, inGroup } from './queries';
import { WORK_SUBS, workSub } from './subs';
import { useMyDay } from './myDay';

// group "My work", as in Plane: summary, assigned, comments for me, created, watched, activity
const props = defineProps<{ scope: GroupScope }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { user } = useAuth();
const spaces = useSpaces();
// sections — tabs, «My day» first (PLNRAPP-84); the task sections' view — in their «View» menu
const MENTIONS = ['mentioned', 'chat_mention', 'doc_mention'];
const sub = computed(() => workSub(route.query.w));
const pick = (w: string) => void router.replace({ query: { ...route.query, w } });
// on mobile the tabs show only icons (Tabs hides the label) — PLNRAPP-90
const SUB_ICONS = {
  day: Sun,
  assigned: UserRound,
  comments: MessageSquare,
  mentions: AtSign,
  created: SquarePen,
  watched: Eye,
  activity: History,
  summary: LayoutDashboard,
};
const subTabs = computed(() =>
  WORK_SUBS.map((w) => ({
    value: w,
    label: w === 'day' ? t('myDay.title') : t(`work.${w}`),
    icon: SUB_ICONS[w],
    // counts of active records (PLNRAPP-121); zero is hidden
    count: subCounts.value[w] || undefined,
  })),
);
const taskSub = computed(() =>
  sub.value === 'day'
    ? 'assigned'
    : (['assigned', 'created', 'watched'] as const).find((w) => w === sub.value),
);

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
const users = useUsers();
const userName = (id: string) => users.value?.find((u) => u.id === id)?.name ?? '?';
// "Comments for me": open (default), resolved or all
const commentFilter = ref<'open' | 'resolved' | 'all'>('open');
const shownComments = computed(() =>
  mine.value.filter((c) =>
    commentFilter.value === 'all' ? true : (commentFilter.value === 'open') === !c.resolvedAt,
  ),
);
const openComments = computed(() => mine.value.filter((c) => !c.resolvedAt));
const unreadAll = computed(
  () => (unread.value ?? []).filter((n) => inGroup(n, props.scope)).length,
);
const unreadMentions = computed(
  () =>
    (unread.value ?? []).filter((n) => MENTIONS.includes(n.kind) && inGroup(n, props.scope)).length,
);
const today = new Date().toISOString().slice(0, 10);
const count = (rows: { projectId: string }[] | undefined) =>
  (rows ?? []).filter((r) => inScope(r.projectId)).length;
const day = useMyDay(uid);
// task tabs count open tasks; «My day» — today's not done
const subCounts = computed<Partial<Record<string, number>>>(() => ({
  day: (day.value?.today ?? []).filter((x) => !x.done && inScope(x.task.projectId)).length,
  assigned: count(assigned.value),
  created: count(created.value),
  watched: count(watched.value),
  comments: openComments.value.length,
  mentions: unreadMentions.value,
  activity: unreadAll.value,
}));
const tiles = computed(() => [
  { w: 'assigned', n: count(assigned.value) },
  {
    w: 'assigned',
    key: 'overdue',
    n: (assigned.value ?? []).filter((r) => inScope(r.projectId) && r.dueDate && r.dueDate < today)
      .length,
  },
  { w: 'comments', n: openComments.value.length },
  { w: 'mentions', n: unreadMentions.value },
  { w: 'created', n: count(created.value) },
  { w: 'watched', n: count(watched.value) },
  { w: 'activity', key: 'unread', n: unreadAll.value },
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
    <!-- задачи (Мой день, Назначенные, Созданные, Отслеживаемые): вид с закреплённым Me Mode, табы разделов — в его панели -->
    <ScopeTasks
      v-if="taskSub"
      :key="sub"
      class="min-h-0 flex-1"
      :me="taskSub"
      :day="sub === 'day'"
      :space-id="scope.level === 'space' ? scope.spaceId : undefined"
      :project-id="scope.projectId ?? undefined"
      :root-space-id="scope.rootSpaceId"
    >
      <template #tabs>
        <Tabs
          :model-value="sub"
          :label="t('work.title')"
          :items="subTabs"
          data-testid="work-tabs"
          @update:model-value="pick"
        />
      </template>
    </ScopeTasks>
    <div v-else class="flex h-11 shrink-0 items-center overflow-x-auto border-b border-border px-2">
      <Tabs
        :model-value="sub"
        :label="t('work.title')"
        :items="subTabs"
        data-testid="work-tabs"
        @update:model-value="pick"
      />
    </div>
    <div v-if="!taskSub" class="min-h-0 flex-1 overflow-y-auto">
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
      <div v-else-if="sub === 'comments'" class="flex flex-col gap-1 p-4">
        <Tabs
          v-model="commentFilter"
          class="mb-2"
          :label="t('work.commentFilter')"
          :items="[
            { value: 'open', label: t('work.commentOpen') },
            { value: 'resolved', label: t('work.commentResolved') },
            { value: 'all', label: t('inbox.all') },
          ]"
        />
        <EmptyState v-if="comments && !shownComments.length" :title="t('work.noComments')" />
        <!-- a card (PLNRAPP-118): task on top, text up to 3 lines, author and date below — readable on mobile -->
        <div
          v-for="c in shownComments"
          :key="c.id"
          data-testid="work-comment"
          class="flex gap-1 rounded-lg border border-border p-2 hover:bg-bg-muted"
        >
          <button
            type="button"
            :aria-label="t('task.resolved')"
            :aria-pressed="!!c.resolvedAt"
            class="flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg outline-none focus-visible:ring-2 ring-focus"
            @click="mutate('comment.resolve', { id: c.id, resolved: !c.resolvedAt })"
          >
            <CheckCircle2 v-if="c.resolvedAt" :size="18" class="text-success" />
            <Circle v-else :size="18" />
          </button>
          <button
            type="button"
            class="flex min-w-0 flex-1 flex-col gap-1 rounded-md py-1 text-left text-sm outline-none focus-visible:ring-2 ring-focus"
            @click="openTask(c.key)"
          >
            <span class="flex min-w-0 items-baseline gap-2 text-xs text-fg-subtle">
              <span class="shrink-0">{{ c.key }}</span>
              <span class="truncate">{{ c.title }}</span>
            </span>
            <span
              :class="['line-clamp-3 break-words', c.resolvedAt && 'text-fg-muted line-through']"
              >{{ textOf(c.body) }}</span
            >
            <span class="text-xs text-fg-subtle">
              {{ userName(c.authorId) }} ·
              <time :datetime="c.createdAt">{{ new Date(c.createdAt).toLocaleString() }}</time>
            </span>
          </button>
        </div>
      </div>
      <InboxScreen v-else-if="sub === 'mentions'" :scope="scope" :kinds="MENTIONS" />
      <InboxScreen v-else :scope="scope" />
    </div>
  </div>
</template>
