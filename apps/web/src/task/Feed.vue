<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
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
const { user } = useAuth();
const comments = useComments(props.task.id);
const users = useUsers();
const reactions = useReactions(props.task.id);
const members = useMembers(() => props.task.spaceId);
const labels = useLabels(() => props.task.spaceId);
const draft = shallowRef<JSONContent | null>(null); // shallow: в IndexedDB нельзя класть reactive-прокси
const composer = ref<InstanceType<typeof Editor>>();
const activity = ref<Row<'activity'>[]>([]);

// история — только при сети; офлайн/ошибка — остаются комментарии, без сообщения
async function load() {
  try {
    activity.value = (
      await api<{ rows: Row<'activity'>[] }>('GET', `/api/tasks/${props.task.id}/activity`)
    ).rows;
  } catch {
    /* офлайн */
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
    ...(comments.value ?? []).map((c) => ({ at: c.createdAt, id: c.id, comment: c })),
    // комментарий и так в ленте
    ...activity.value
      .filter((a) => a.kind !== 'commented')
      .map((a) => ({ at: a.createdAt, id: a.id, act: a })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)),
);

const setDraft = (v: JSONContent | null) => (draft.value = v);

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
    <h3 class="text-sm font-medium text-fg-muted">{{ t('task.activity') }}</h3>
    <template v-for="e in feed" :key="e.id">
      <CommentItem
        v-if="'comment' in e"
        :comment="e.comment"
        :author="nameOf(e.comment.authorId)"
        :avatar="
          userOf(e.comment.authorId)?.avatarFile
            ? `/files/${userOf(e.comment.authorId)!.avatarFile}/preview?w=256`
            : null
        "
        :mine="e.comment.authorId === user?.id"
        :reactions="(reactions ?? []).filter((r) => r.commentId === e.comment.id)"
        :user-id="user?.id"
        :names="Object.fromEntries((users ?? []).map((u) => [u.id, u.name]))"
        @react="
          (emoji) => mutate('reaction.toggle', { id: newId(), commentId: e.comment.id, emoji })
        "
        :members="(members ?? []).map((m) => ({ id: m.id, name: m.name }))"
        @save="(body) => mutate('comment.update', { id: e.comment.id, body })"
        @remove="mutate('comment.delete', { id: e.comment.id })"
      />
      <p v-else class="text-xs text-fg-muted" data-testid="activity">{{ describe(e.act) }}</p>
    </template>
    <div class="rounded-md border border-border-strong p-2">
      <Editor
        ref="composer"
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
