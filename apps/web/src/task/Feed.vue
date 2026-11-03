<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import { api } from '../api/http';
import { useAuth } from '../auth/useAuth';
import { mutate, newId } from '../sync';
import { useLabels, useMembers, type TaskView } from '../tasks';
import { Button } from '../ui';
import CommentItem from './CommentItem.vue';
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
const feed = computed<Entry[]>(() =>
  [
    // in the feed — thread roots; replies — under their own root
    ...(comments.value ?? [])
      .filter((c) => !c.parentId)
      .map((c) => ({ at: c.createdAt, id: c.id, comment: c })),
    // the comment is in the feed already
    ...activity.value
      .filter((a) => a.kind !== 'commented')
      .map((a) => ({ at: a.createdAt, id: a.id, act: a })),
    // equal time — by id (uuidv7: insertion order), otherwise the order depends on the DB read
  ].sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at < b.at ? -1 : 1)),
);

// new entries at the bottom, by the comment field: the feed sticks to the end
const list = ref<HTMLElement>();
watch(
  () => feed.value.length,
  async () => {
    await nextTick();
    list.value?.scrollTo({ top: list.value.scrollHeight });
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
const replyBox = ref<InstanceType<typeof Editor>[]>();
async function startReply(id: string) {
  replyTo.value = id;
  replyDraft.value = null;
  await nextTick();
  replyBox.value?.[0]?.focus?.();
}
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

async function send() {
  const body = draft.value;
  if (!body) return;
  setDraft(null);
  composer.value?.clear();
  await mutate('comment.create', { id: newId(), taskId: props.task.id, body });
}
</script>

<template>
  <section :aria-label="t('task.activity')" class="flex flex-col gap-3">
    <h3 class="text-sm font-medium text-fg">{{ t('task.activity') }}</h3>
    <!-- лента прокручивается, поле комментария — внизу колонки (в колонке активности карточки) -->
    <div ref="list" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-testid="feed">
      <template v-for="e in feed" :key="e.id">
        <CommentItem
          v-if="'comment' in e"
          :comment="e.comment"
          :author="nameOf(e.comment.authorId)"
          :avatar="avatarOf(e.comment.authorId)"
          :mine="e.comment.authorId === user?.id"
          :reactions="(reactions ?? []).filter((r) => r.commentId === e.comment.id)"
          :user-id="user?.id"
          :names="names"
          :members="memberList"
          root
          :can-resolve="canResolve(e.comment)"
          @react="(emoji) => react(e.comment.id, emoji)"
          @save="(body) => mutate('comment.update', { id: e.comment.id, body })"
          @remove="mutate('comment.delete', { id: e.comment.id })"
          @reply="startReply(e.comment.id)"
          @assign="(u) => mutate('comment.assign', { id: e.comment.id, assigneeId: u })"
          @resolve="(done) => mutate('comment.resolve', { id: e.comment.id, resolved: done })"
        >
          <div
            v-if="replies.get(e.comment.id)?.length || replyTo === e.comment.id"
            class="mt-2 flex flex-col gap-2 border-l-2 border-border pl-3"
            data-testid="thread"
          >
            <CommentItem
              v-for="r in replies.get(e.comment.id) ?? []"
              :key="r.id"
              :comment="r"
              :author="nameOf(r.authorId)"
              :avatar="avatarOf(r.authorId)"
              :mine="r.authorId === user?.id"
              :reactions="(reactions ?? []).filter((x) => x.commentId === r.id)"
              :user-id="user?.id"
              :names="names"
              :members="memberList"
              @react="(emoji) => react(r.id, emoji)"
              @save="(body) => mutate('comment.update', { id: r.id, body })"
              @remove="mutate('comment.delete', { id: r.id })"
            />
            <div
              v-if="replyTo === e.comment.id"
              class="rounded-md border border-border-strong bg-bg p-2"
              data-testid="reply-box"
            >
              <Editor
                ref="replyBox"
                refs
                :model-value="replyDraft"
                :members="memberList"
                :label="t('task.replyPlaceholder')"
                :placeholder="t('task.replyPlaceholder')"
                @update:model-value="setReply"
                @submit="sendReply"
              />
              <div class="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" @click="replyTo = null">{{
                  t('task.cancel')
                }}</Button>
                <Button
                  size="sm"
                  variant="primary"
                  :disabled="!replyDraft"
                  data-testid="reply-send"
                  @click="sendReply"
                  >{{ t('task.send') }}</Button
                >
              </div>
            </div>
          </div>
        </CommentItem>
        <p v-else class="text-xs text-fg-muted" data-testid="activity">{{ describe(e.act) }}</p>
      </template>
    </div>
    <div class="shrink-0 rounded-md border border-border-strong bg-bg p-2">
      <Editor
        ref="composer"
        refs
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
  </section>
</template>
