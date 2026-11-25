<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import { api } from '../api/http';
import { useAuth } from '../auth/useAuth';
import { useAdminSpaces } from '../screens/settings/shared';
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
import { avatarSrc } from '../pickers';
import CommentThread from './CommentThread.vue';
import ActorAvatar from './ActorAvatar.vue';
import { actKey, groupRuns, mergeChanges } from './activityGroups';
import { FEED } from './thread';
import Editor from './editor/Editor.vue';
import { useCommentFiles, useComments, useReactions, useUsers } from './queries';
import AttachButton from './AttachButton.vue';
import DraftFiles from './DraftFiles.vue';
import { EMPTY_DOC, useDraftFiles } from './commentFiles';
import { commentJump } from './jump';
import { useTaskDetails } from './details';
import { router } from '../router';

const props = defineProps<{ task: TaskView }>();
const { t, te, locale } = useI18n();
const { user } = useAuth();
// comment.resolve: the assignee, the author or an admin of the comment's space (the mutator's rule)
const isSpaceAdmin = useAdminSpaces();
const comments = useComments(props.task.id);
// C-sync v3 (PLNRAPP-487): comments are loaded on open when the task is not held
const details = useTaskDetails(props.task.id);
const users = useUsers();
const reactions = useReactions(props.task.id);
const commentFiles = useCommentFiles(props.task.id);
const NO_FILES: Row<'attachments'>[] = [];
const files = useDraftFiles();
const replyFiles = useDraftFiles();
const NO_REACTIONS: Row<'commentReactions'>[] = [];
const reactionsBy = computed(() => {
  const m = new Map<string, Row<'commentReactions'>[]>();
  for (const r of reactions.value ?? []) m.set(r.commentId, [...(m.get(r.commentId) ?? []), r]);
  return m;
});
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
// the description is saved by collab every few seconds while typing: it (and updatedAt) doesn't reload the
// history, the other fields do — debounced
let loadTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () =>
    JSON.stringify(props.task, (k, v) =>
      k === 'description' || k === 'updatedAt' ? undefined : v,
    ),
  () => {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(load, 1500);
  },
);
onBeforeUnmount(() => clearTimeout(loadTimer));

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

// PLNRAPP-825: a run of equal actions (oldest first) — one entry; the author — an avatar next to it
function describe(acts: Row<'activity'>[]): string {
  const a = acts[0]!;
  if (a.kind === 'updated') {
    const fields = Object.entries(mergeChanges(acts))
      .map(([f, pair]) => change(f, pair))
      .join('; ');
    return t('task.act.updated', { fields });
  }
  const whats = acts.map((x) => {
    const ch = x.changes as Record<string, unknown>;
    if (x.kind.startsWith('merged_')) return `«${String(ch.title)}»`;
    return x.kind.startsWith('assignee_')
      ? nameOf(String(ch.userId))
      : (labels.value?.find((l) => l.id === ch.labelId)?.name ?? '—');
  });
  return t(`task.act.${a.kind}`, { what: [...new Set(whats)].join(', ') });
}
// the date and time of the entry; a run — from the first to the last, the time only within a day
const stamp = (v: string, time = false) =>
  new Date(v).toLocaleString(
    locale.value,
    time ? { timeStyle: 'short' } : { dateStyle: 'short', timeStyle: 'short' },
  );
function when(acts: Row<'activity'>[]): string {
  const first = acts[0]!.createdAt;
  const last = acts.at(-1)!.createdAt;
  if (stamp(first) === stamp(last)) return stamp(last);
  const sameDay = new Date(first).toDateString() === new Date(last).toDateString();
  return `${stamp(first)} – ${stamp(last, sameDay)}`;
}

type Entry =
  | { at: string; id: string; comment: Row<'comments'> }
  | { at: string; id: string; act: Row<'activity'> }
  | { at: string; id: string; acts: Row<'activity'>[] };
const newestFirst = ref(true);
const show = ref<'all' | 'comments' | 'history'>('all');
const showOptions = computed(() =>
  (['all', 'comments', 'history'] as const).map((value) => ({
    value,
    label: t(`task.feedShow.${value}`),
  })),
);
const feed = computed<Entry[]>(() => {
  const asc: Entry[] = [
    // in the feed — thread roots; replies — under their own root
    ...(show.value === 'history' ? [] : (comments.value ?? []))
      .filter((c) => !c.parentId)
      .map((c) => ({ at: c.createdAt, id: c.id, comment: c })),
    // the comment is in the feed already
    ...(show.value === 'comments' ? [] : activity.value)
      .filter((a) => a.kind !== 'commented')
      .map((a) => ({ at: a.createdAt, id: a.id, act: a })),
    // equal time — by id (uuidv7: insertion order), otherwise the order depends on the DB read
  ].sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1));
  // PLNRAPP-825: consecutive equal actions of one author — one entry, whatever the sort direction
  const grouped = groupRuns(asc, (e) => ('act' in e ? actKey(e.act) : null)).map((run): Entry => {
    const head = run[0]!;
    if (!('act' in head)) return head;
    const acts = run.map((e) => (e as { act: Row<'activity'> }).act);
    return { at: acts.at(-1)!.createdAt, id: head.id, acts };
  });
  return newestFirst.value ? grouped.reverse() : grouped;
});

// a new entry lands next to the composer only with the newest on top; oldest first — follow it to the end
const list = ref<HTMLElement>();
watch(
  () => feed.value.length,
  async () => {
    await nextTick();
    // while the jump to a comment blinks (PLNRAPP-214), the late rows of the replica keep it in view
    if (jumpTo?.isConnected) return jumpTo.scrollIntoView({ block: 'center' });
    list.value?.scrollTo({ top: newestFirst.value ? 0 : list.value.scrollHeight });
  },
);
let jumpTo: HTMLElement | undefined;

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
  if ((!body && !replyFiles.ready.value.length) || replyFiles.busy.value || !parentId) return;
  const attachments = replyFiles.args();
  replyTo.value = null;
  setReply(null);
  replyFiles.clear();
  await mutate('comment.create', {
    id: newId(),
    taskId: props.task.id,
    body: body ?? EMPTY_DOC,
    parentId,
    attachments,
  });
}
const canResolve = (c: Row<'comments'>) =>
  !!user.value &&
  (c.assigneeId === user.value.id || c.authorId === user.value.id || isSpaceAdmin(c.spaceId));
const avatarOf = (id: string) => avatarSrc(userOf(id));
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
// PLNRAPP-214: ?comment=<id> — unfold the branch, open the thread if needed, scroll to the comment and blink it;
// the comment may arrive in the replica later (bootstrap in stages) — the watch fires again with the comments
const root = ref<HTMLElement>();
const wanted = computed(() => {
  const q = router.currentRoute.value.query.comment;
  return typeof q === 'string' ? q : '';
});
watch(
  [wanted, comments],
  async () => {
    const id = wanted.value;
    const j = id && comments.value ? commentJump(comments.value, id) : null;
    if (!id || !j) return;
    void router.replace({ query: { ...router.currentRoute.value.query, comment: undefined } });
    show.value = 'all';
    folded.value = new Set([...folded.value].filter((x) => !j.unfold.includes(x)));
    threads.value = j.thread ? [j.thread] : [];
    await nextTick();
    // the thread view comes before the (then hidden) feed in the DOM
    const el = root.value?.querySelector<HTMLElement>(`[data-comment="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('comment-flash');
    jumpTo = el;
    setTimeout(() => {
      el.classList.remove('comment-flash');
      if (jumpTo === el) jumpTo = undefined;
    }, 1600);
  },
  { immediate: true },
);
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
  replyFiles,
  filesOf: (id: string) => commentFiles.value?.get(id) ?? NO_FILES,
  userId: () => user.value?.id,
  names,
  members: memberList,
  reactionsOf: (id: string) => reactionsBy.value.get(id) ?? NO_REACTIONS,
  nameOf,
  avatarOf,
  canResolve,
  react,
});

// a comment — text and/or files (PLNRAPP-372); sent when the uploads are done
const canSend = computed(() => (!!draft.value || !!files.ready.value.length) && !files.busy.value);
async function send() {
  const body = draft.value;
  if (!canSend.value) return;
  const attachments = files.args();
  setDraft(null);
  composer.value?.clear();
  files.clear();
  await mutate('comment.create', {
    id: newId(),
    taskId: props.task.id,
    body: body ?? EMPTY_DOC,
    attachments,
  });
}
defineExpose({ focusComposer: () => composer.value?.focus() });
</script>

<template>
  <section ref="root" :aria-label="t('task.activity')" class="flex flex-col gap-3">
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
    <DraftFiles
      v-else
      :draft="files"
      class="shrink-0 rounded-md border border-border-strong bg-bg p-2"
    >
      <Editor
        ref="composer"
        refs
        image
        files
        :model-value="draft"
        @update:model-value="setDraft"
        :members="
          (members ?? []).map((m) => ({ id: m.id, name: m.name, avatarFile: m.avatarFile }))
        "
        :label="t('task.newComment')"
        :placeholder="t('task.newComment')"
        @submit="send"
        @attach="files.add"
      />
      <template #actions>
        <AttachButton :draft="files" />
        <Button
          size="sm"
          variant="primary"
          class="ml-auto"
          :disabled="!canSend"
          data-testid="comment-send"
          @click="send"
        >
          {{ t('task.send') }}
        </Button>
      </template>
    </DraftFiles>
    <!-- поле комментария — над лентой, лента прокручивается под ним -->
    <div
      v-show="!thread"
      ref="list"
      class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
      data-testid="feed"
    >
      <div
        v-if="details === 'loading' && show !== 'history' && !feed.length"
        role="status"
        :aria-label="t('task.detailsLoading')"
        class="flex flex-col gap-3"
        data-testid="feed-skeleton"
      >
        <div v-for="i in 3" :key="i" class="h-14 animate-pulse rounded-md bg-bg-muted" />
      </div>
      <p
        v-else-if="details === 'offline' && show !== 'history'"
        class="text-sm text-fg-muted"
        data-testid="feed-offline"
      >
        {{ t('task.detailsOffline') }}
      </p>
      <template v-for="e in feed" :key="e.id">
        <CommentThread v-if="'comment' in e" :comment="e.comment" />
        <div
          v-else-if="'acts' in e"
          class="flex items-start gap-2 text-xs text-fg-muted"
          data-testid="activity"
        >
          <ActorAvatar :name="nameOf(e.acts[0]!.actorId)" :src="avatarOf(e.acts[0]!.actorId)" />
          <span class="min-w-0 flex-1" data-testid="activity-text">{{ describe(e.acts) }}</span>
          <time
            class="shrink-0 whitespace-nowrap text-fg-subtle"
            :datetime="e.at"
            data-testid="activity-time"
          >
            {{ when(e.acts) }}
          </time>
        </div>
      </template>
    </div>
  </section>
</template>
