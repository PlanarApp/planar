<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import { api } from '../api/http';
import { useAuth } from '../auth/useAuth';
import { mutate, newId } from '../sync';
import { useLabels, useMembers, type TaskView } from '../tasks';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-vue-next';
import { Button, IconButton, Select } from '../ui';
import CommentThread from './CommentThread.vue';
import { FEED } from './thread';
import Editor from './editor/Editor.vue';
import { useComments, useReactions, useUsers } from './queries';

const props = defineProps<{ task: TaskView }>();
const { t, te } = useI18n();
const { user, isAdmin } = useAuth();
const comments = useComments(props.task.id);
const users = useUsers();
const reactions = useReactions(props.task.id);
const members = useMembers(() => props.task.spaceId);
const labels = useLabels(() => props.task.spaceId);
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

function describe(a: Row<'activity'>): string {
  const who = nameOf(a.actorId);
  const ch = a.changes as Record<string, unknown>;
  if (a.kind === 'updated') {
    const fields = Object.keys(ch)
      .map((f) => (te(`task.fields.${f}`) ? t(`task.fields.${f}`) : f))
      .join(', ');
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
const memberList = computed(() => (members.value ?? []).map((m) => ({ id: m.id, name: m.name })));
const names = computed(() => Object.fromEntries((users.value ?? []).map((u) => [u.id, u.name])));
const react = (commentId: string, emoji: string) =>
  mutate('reaction.toggle', { id: newId(), commentId, emoji });
provide(FEED, {
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
        size="sm"
        :icon="newestFirst ? ArrowDownWideNarrow : ArrowUpNarrowWide"
        :label="newestFirst ? t('task.feedNewestFirst') : t('task.feedOldestFirst')"
        data-testid="feed-sort"
        @click="newestFirst = !newestFirst"
      />
    </div>
    <div class="shrink-0 rounded-md border border-border-strong bg-bg p-2">
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
    <div ref="list" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-testid="feed">
      <template v-for="e in feed" :key="e.id">
        <CommentThread v-if="'comment' in e" :comment="e.comment" />
        <p v-else class="text-xs text-fg-muted" data-testid="activity">{{ describe(e.act) }}</p>
      </template>
    </div>
  </section>
</template>
