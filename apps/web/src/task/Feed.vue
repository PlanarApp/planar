<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import { api } from '../api/http';
import { useAuth } from '../auth/useAuth';
import { mutate, newId } from '../sync';
import { useLabels, useMembers, useStatuses, type TaskView } from '../tasks';
import { useSpaces } from '../tasks/queries';
import { formatDue } from '../views/list/due';
import {
  ArrowLeft,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-vue-next';
import { Button, IconButton, Select } from '../ui';
import CommentThread from './CommentThread.vue';
import { FEED } from './thread';
import Editor from './editor/Editor.vue';
import { useComments, useReactions, useUsers } from './queries';

const props = defineProps<{ task: TaskView }>();
const { t, te, locale } = useI18n();
const { user, isAdmin } = useAuth();
const comments = useComments(props.task.id);
const users = useUsers();
const reactions = useReactions(props.task.id);
const members = useMembers(() => props.task.spaceId);
const labels = useLabels(() => props.task.spaceId);
// the whole space: a moved task's old status is of another project
const statuses = useStatuses(() => props.task.spaceId);
const spaces = useSpaces();
const draft = shallowRef<JSONContent | null>(null); // shallow: reactive proxies can't be stored in IndexedDB
const composer = ref<InstanceType<typeof Editor>>();
const activity = ref<Row<'activity'>[]>([]);

// history — only online; offline/error — comments remain, without a message
async function load() {
  try {
    activity.value = (
      await api<{ rows: Row<'activity'>[] }>('GET', `/api/tasks/${props.task.id}/activity`)
    ).rows;
  } catch {
    /* offline */
  }
}
onMounted(load);
watch(
  () => [props.task.updatedAt, props.task.assigneeIds.join(), props.task.labelIds.join()],
  load,
);

const userOf = (id: string) => users.value?.find((u) => u.id === id);
const nameOf = (id: string) => userOf(id)?.name ?? '—';

// what changed into what (PLNRAPP-109); the description, parent and custom fields — the name only
const projectOf = (id: string) =>
  spaces.value?.flatMap((s) => s.projects).find((p) => p.id === id)?.name;
const date = (v: string) => formatDue(v.slice(0, 10), locale.value);
const values: Record<string, (v: unknown) => string | undefined> = {
  title: (v) => `«${String(v)}»`,
  statusId: (v) => statuses.value?.find((s) => s.id === v)?.name,
  priority: (v) => t(`tasks.priority.${Number(v)}`),
  dueDate: (v) => date(String(v)),
  startDate: (v) => date(String(v)),
  completedAt: (v) => date(String(v)),
  projectId: (v) => projectOf(String(v)),
};
const valueOf = (f: string, v: unknown) => (v == null || v === '' ? '—' : (values[f]!(v) ?? '—'));
function change(f: string, pair: unknown): string {
  const name = te(`task.fields.${f}`) ? t(`task.fields.${f}`) : f;
  if (!values[f] || !Array.isArray(pair)) return name;
  return `${name}: ${valueOf(f, pair[0])} → ${valueOf(f, pair[1])}`;
}

function describe(a: Row<'activity'>): string {
  const who = nameOf(a.actorId);
  const ch = a.changes as Record<string, unknown>;
  if (a.kind === 'updated') {
    const fields = Object.entries(ch)
      .map(([f, pair]) => change(f, pair))
      .join('; ');
    return t('task.act.updated', { who, fields });
  }
  const what = a.kind.startsWith('assignee_')
    ? nameOf(String(ch.userId))
    : (labels.value?.find((l) => l.id === ch.labelId)?.name ?? '—');
  return t(`task.act.${a.kind}`, { who, what });
}

type Entry =
  | { at: string; id: string; comment: Row<'comments'> }
  | { at: string; id: string; act: Row<'activity'> };
const newestFirst = ref(true);
const show = ref<'all' | 'comments' | 'history'>('all');
const showOptions = computed(() =>
  (['all', 'comments', 'history'] as const).map((value) => ({
    value,
    label: t(`task.feedShow.${value}`),
  })),
);
const feed = computed<Entry[]>(() => {
  const dir = newestFirst.value ? -1 : 1;
  return [
    // in the feed — thread roots; replies — under their own root
    ...(show.value === 'history' ? [] : (comments.value ?? []))
      .filter((c) => !c.parentId)
      .map((c) => ({ at: c.createdAt, id: c.id, comment: c })),
    // the comment is in the feed already
    ...(show.value === 'comments' ? [] : activity.value)
      .filter((a) => a.kind !== 'commented')
      .map((a) => ({ at: a.createdAt, id: a.id, act: a })),
    // equal time — by id (uuidv7: insertion order), otherwise the order depends on the DB read
  ].sort((a, b) => dir * (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1));
});

// a new entry lands next to the composer only with the newest on top; oldest first — follow it to the end
const list = ref<HTMLElement>();
watch(
  () => feed.value.length,
  async () => {
    await nextTick();
    list.value?.scrollTo({ top: newestFirst.value ? 0 : list.value.scrollHeight });
  },
);

const setDraft = (v: JSONContent | null) => (draft.value = v);

// threads: replies by root, by time
const replies = computed(() => {
  const m = new Map<string, Row<'comments'>[]>();
  for (const c of comments.value ?? [])
    if (c.parentId) (m.get(c.parentId) ?? m.set(c.parentId, []).get(c.parentId)!).push(c);
  for (const l of m.values())
    l.sort((a, b) =>
      a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1,
    );
  return m;
});
const replyTo = ref<string | null>(null);
const replyDraft = shallowRef<JSONContent | null>(null);
const setReply = (v: JSONContent | null) => (replyDraft.value = v);
async function sendReply() {
  const body = replyDraft.value;
  const parentId = replyTo.value;
  if (!body || !parentId) return;
  replyTo.value = null;
  setReply(null);
  await mutate('comment.create', { id: newId(), taskId: props.task.id, body, parentId });
}
const canResolve = (c: Row<'comments'>) =>
  !!user.value && (c.assigneeId === user.value.id || c.authorId === user.value.id || isAdmin.value);
const avatarOf = (id: string) =>
  userOf(id)?.avatarFile ? `/files/${userOf(id)!.avatarFile}/preview?w=256` : null;
const memberList = computed(() =>
  (members.value ?? []).map((m) => ({ id: m.id, name: m.name, avatar: avatarOf(m.id) })),
);
const names = computed(() => Object.fromEntries((users.value ?? []).map((u) => [u.id, u.name])));
const react = (commentId: string, emoji: string) =>
  mutate('reaction.toggle', { id: newId(), commentId, emoji });
// collapsed comments (PLNRAPP-194): a new one is not in the set — it appears expanded
const folded = ref(new Set<string>());
// the shown comments: the filter «History» hides them all, and the button with them
const shownComments = computed(() => (show.value === 'history' ? [] : (comments.value ?? [])));
const anyExpanded = computed(() => shownComments.value.some((c) => !folded.value.has(c.id)));
function toggleAll() {
  const collapse = anyExpanded.value;
  const s = new Set(folded.value);
  for (const c of shownComments.value) {
    if (collapse) s.add(c.id);
    else s.delete(c.id);
  }
  folded.value = s;
}
// the open thread and the threads above it (PLNRAPP-201): «Back» goes one level up, the last one — to the feed
const threads = ref<string[]>([]);
const thread = computed(() => {
  const id = threads.value.at(-1);
  return id ? comments.value?.find((c) => c.id === id) : undefined;
});
// the root is deleted (here or by another user) — back to where it is still there
watch(thread, (c) => {
  if (!c && threads.value.length && comments.value) threads.value = threads.value.slice(0, -1);
});
function openThread(id: string) {
  if (threads.value.at(-1) !== id) threads.value = [...threads.value, id];
}
function closeThread() {
  replyTo.value = null;
  threads.value = threads.value.slice(0, -1);
}
provide(FEED, {
  openThread,
  folded,
  replies,
  replyTo,
  replyDraft,
  sendReply,
  userId: () => user.value?.id,
  names,
  members: memberList,
  reactions,
  nameOf,
  avatarOf,
  canResolve,
  react,
});

async function send() {
  const body = draft.value;
  if (!body) return;
  setDraft(null);
  composer.value?.clear();
  await mutate('comment.create', { id: newId(), taskId: props.task.id, body });
}
defineExpose({ focusComposer: () => composer.value?.focus() });
</script>

<template>
  <section :aria-label="t('task.activity')" class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <h3 class="flex-1 text-sm font-medium text-fg">{{ t('task.activity') }}</h3>
      <Select
        v-model="show as string"
        size="sm"
        :label="t('task.feedShow.label')"
        :options="showOptions"
        data-testid="feed-show"
      />
      <IconButton
        v-if="shownComments.length"
        size="sm"
        :icon="anyExpanded ? ChevronsDownUp : ChevronsUpDown"
        :label="anyExpanded ? t('task.collapseAllComments') : t('task.expandAllComments')"
        data-testid="feed-fold-all"
        @click="toggleAll"
      />
      <IconButton
        size="sm"
        :icon="newestFirst ? ArrowDownWideNarrow : ArrowUpNarrowWide"
        :label="newestFirst ? t('task.feedNewestFirst') : t('task.feedOldestFirst')"
        data-testid="feed-sort"
        @click="newestFirst = !newestFirst"
      />
    </div>
    <!-- тред на всю ленту (PLNRAPP-201): исходный комментарий, его ответы, глубже — сабтреды -->
    <div
      v-if="thread"
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
      data-testid="thread-view"
    >
      <Button
        size="sm"
        variant="ghost"
        class="self-start"
        :icon="ArrowLeft"
        data-testid="thread-back"
        @click="closeThread"
      >
        {{ threads.length > 1 ? t('task.threadUp') : t('task.threadBack') }}
      </Button>
      <CommentThread :key="thread.id" :comment="thread" />
    </div>
    <div v-else class="shrink-0 rounded-md border border-border-strong bg-bg p-2">
      <Editor
        ref="composer"
        refs
        image
        :model-value="draft"
        @update:model-value="setDraft"
        :members="(members ?? []).map((m) => ({ id: m.id, name: m.name }))"
        :label="t('task.newComment')"
        :placeholder="t('task.newComment')"
        @submit="send"
      />
      <div class="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="primary"
          :disabled="!draft"
          data-testid="comment-send"
          @click="send"
        >
          {{ t('task.send') }}
        </Button>
      </div>
    </div>
    <!-- поле комментария — над лентой, лента прокручивается под ним -->
    <div
      v-show="!thread"
      ref="list"
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
      data-testid="feed"
    >
      <template v-for="e in feed" :key="e.id">
        <CommentThread v-if="'comment' in e" :comment="e.comment" />
        <p v-else class="text-xs text-fg-muted" data-testid="activity">{{ describe(e.act) }}</p>
      </template>
    </div>
  </section>
</template>
