<script setup lang="ts">
import { computed, inject, shallowRef, ref } from 'vue';
import {
  CheckCircle2,
  Circle,
  MessageSquareReply,
  Pencil,
  Trash2,
  UserPlus,
} from '@lucide/vue';
import { useI18n } from 'vue-i18n';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import { Avatar, Button, IconButton } from '../ui';
import { UserPicker } from '../pickers';
import Reactions from './Reactions.vue';
import Editor from './editor/Editor.vue';
import WorkStatus from './WorkStatus.vue';
import AttachButton from './AttachButton.vue';
import CommentFiles from './CommentFiles.vue';
import DraftFiles from './DraftFiles.vue';
import { EMPTY_DOC, useDraftFiles, type FileArgs } from './commentFiles';
import { TASK_ACTIVITY, activityOf } from '../modules/activity';

const props = defineProps<{
  comment: Row<'comments'>;
  author: string;
  avatar?: string | null;
  assigneeAvatar?: string | null;
  mine: boolean;
  members: { id: string; name: string; avatar?: string | null }[];
  reactions: Row<'commentReactions'>[];
  /** files of the comment (PLNRAPP-372) */
  files?: Row<'attachments'>[];
  userId?: string;
  names: Record<string, string>;
  /** "Reply" — on any comment (replies at any depth) */
  canReply?: boolean;
  /** assigned comment of any depth (PLNRAPP-135): the assignee, author or admin can resolve */
  canResolve?: boolean;
}>();
const emit = defineEmits<{
  save: [body: JSONContent, files?: { attachments: FileArgs[]; removeAttachments: string[] }];
  remove: [];
  react: [emoji: string];
  reply: [];
  assign: [userId: string | null];
  resolve: [done: boolean];
}>();
// PLNRAPP-202: the AI answers this comment — a ring around its avatar while it runs, the line of its state
const taskWork = inject(TASK_ACTIVITY, null);
const work = computed(() =>
  taskWork
    ? activityOf(
        taskWork.items.value.filter((a) => a.state !== 'done'),
        props.comment.id,
      )
    : undefined,
);
const ring = (userId?: string | null) =>
  work.value?.state === 'running' && !!userId && work.value.actorId === userId && 'work-ring';
/** the AI is not the assignee (a mention, a reply to it): its avatar goes with the line */
const actorAside = computed(
  () => !!work.value?.actorId && work.value.actorId !== props.comment.assigneeId,
);
const { t } = useI18n();
const editing = ref(false);
const draft = shallowRef<JSONContent | null>(null); // shallow: reactive proxies can't be stored in IndexedDB

// editing (PLNRAPP-372): new files and the removed ones are applied on save
const added = useDraftFiles();
const removed = ref(new Set<string>());
const kept = computed(() => (props.files ?? []).filter((a) => !removed.value.has(a.id)));
const canSave = computed(
  () => (!!draft.value || !!kept.value.length || !!added.ready.value.length) && !added.busy.value,
);
function start() {
  draft.value = props.comment.body as JSONContent;
  removed.value = new Set();
  added.clear();
  editing.value = true;
}
function cancel() {
  added.clear();
  editing.value = false;
}
function save() {
  if (!canSave.value) return;
  emit('save', draft.value ?? (EMPTY_DOC as JSONContent), {
    attachments: added.args(),
    removeAttachments: [...removed.value],
  });
  added.clear();
  editing.value = false;
}
</script>

<template>
  <!-- назначенный комментарий — карточка с полосой «Назначено» сверху (PLNRAPP-118) -->
  <div
    :class="[
      'flex flex-col',
      comment.assigneeId &&
        'overflow-hidden rounded-lg border ' +
          (comment.resolvedAt ? 'border-border opacity-75' : 'border-accent/40'),
    ]"
    data-testid="comment"
    :data-comment="comment.id"
  >
    <div
      v-if="comment.assigneeId"
      :class="[
        'flex flex-wrap items-center gap-2 px-2 py-1 text-xs',
        comment.resolvedAt ? 'bg-bg-muted text-fg-muted' : 'bg-accent-subtle',
      ]"
      data-testid="comment-assigned"
    >
      <!-- PLNRAPP-130: «Resolve» on the left, the assignee on the right — a click opens the assignee menu -->
      <Button
        size="sm"
        :variant="comment.resolvedAt ? 'ghost' : 'secondary'"
        :icon="comment.resolvedAt ? CheckCircle2 : Circle"
        :aria-pressed="!!comment.resolvedAt"
        :disabled="!canResolve"
        data-testid="comment-resolve"
        @click="emit('resolve', !comment.resolvedAt)"
      >
        {{ t(comment.resolvedAt ? 'task.resolved' : 'task.resolve') }}
      </Button>
      <span v-if="members.length" class="ml-auto inline-flex min-w-0">
        <UserPicker
          :users="members"
          :selected="comment.assigneeId ? [comment.assigneeId] : []"
          :title="t('task.assignedTo', { name: names[comment.assigneeId] ?? '?' })"
          :none="t('task.unassignComment')"
          @pick="emit('assign', $event)"
        >
          <template #value>
            <Avatar
              :name="names[comment.assigneeId] ?? '?'"
              :src="assigneeAvatar"
              size="sm"
              :class="ring(comment.assigneeId)"
              data-testid="comment-assignee"
            />
            <span class="truncate font-medium">{{ names[comment.assigneeId] ?? '?' }}</span>
          </template>
        </UserPicker>
      </span>
      <span
        v-else
        class="ml-auto inline-flex min-w-0 items-center gap-1"
        :aria-label="t('task.assignedTo', { name: names[comment.assigneeId] ?? '?' })"
      >
        <Avatar
          :name="names[comment.assigneeId] ?? '?'"
          :src="assigneeAvatar"
          size="sm"
          :class="ring(comment.assigneeId)"
        />
        <span class="truncate font-medium">{{ names[comment.assigneeId] ?? '?' }}</span>
      </span>
    </div>
    <!-- PLNRAPP-216: аватар, автор и дата — шапка; текст и действия под ней от левого края аватара -->
    <div :class="['min-w-0', comment.assigneeId && 'p-2']">
      <div class="flex min-w-0 items-center gap-2" data-testid="comment-header">
        <Avatar :name="author" :src="avatar" size="md" />
        <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
          <span class="font-medium">{{ author }}</span>
          <time class="whitespace-nowrap text-xs text-fg-subtle" :datetime="comment.createdAt">
            {{ new Date(comment.createdAt).toLocaleString() }}
          </time>
          <span v-if="comment.editedAt" class="text-xs text-fg-subtle">{{ t('task.edited') }}</span>
        </div>
      </div>
      <div class="mt-1 min-w-0" data-testid="comment-body">
        <DraftFiles v-if="editing" :draft="added">
          <Editor
            v-model="draft"
            refs
            image
            files
            :members="members"
            :label="t('task.comment')"
            @submit="save"
            @attach="added.add"
          />
          <CommentFiles
            :files="kept"
            removable
            @remove="(id) => (removed = new Set(removed).add(id))"
          />
          <template #actions>
            <Button
              size="sm"
              variant="primary"
              :disabled="!canSave"
              data-testid="comment-save"
              @click="save"
              >{{ t('task.save') }}</Button
            >
            <Button size="sm" variant="ghost" @click="cancel">{{ t('task.cancel') }}</Button>
            <AttachButton :draft="added" />
          </template>
        </DraftFiles>
        <template v-else>
          <Editor
            :model-value="comment.body as JSONContent"
            image
            :members="members"
            :label="t('task.comment')"
            :editable="false"
            :link-read-only="mine"
            collapsible
            lazy
            @update:model-value="(b) => mine && b && emit('save', b)"
          />
          <CommentFiles :files="files ?? []" />
          <Reactions
            :rows="reactions"
            :user-id="userId"
            :names="names"
            @toggle="(emoji) => emit('react', emoji)"
          >
            <IconButton
              v-if="canReply"
              size="sm"
              :icon="MessageSquareReply"
              :label="t('task.reply')"
              data-testid="comment-reply"
              @click="emit('reply')"
            />
            <!-- assigned — the assignee in the strip above opens this menu -->
            <UserPicker
              v-if="members.length && !comment.assigneeId"
              :users="members"
              :selected="[]"
              :title="t('task.assignComment')"
              @pick="(id) => id && emit('assign', id)"
            >
              <template #value>
                <UserPlus :size="16" class="text-fg-muted" data-testid="comment-assign" />
              </template>
            </UserPicker>
            <template v-if="mine">
              <IconButton
                size="sm"
                :icon="Pencil"
                :label="t('task.edit')"
                data-testid="comment-edit"
                @click="start"
              />
              <IconButton
                size="sm"
                :icon="Trash2"
                :label="t('task.delete')"
                data-testid="comment-delete"
                @click="emit('remove')"
              />
            </template>
          </Reactions>
        </template>
        <!-- PLNRAPP-400: состояние ИИ — псевдо-ответом под комментарием-триггером, перед ответами -->
        <div v-if="work" class="mt-2 flex items-center gap-1" data-testid="comment-work">
          <Avatar
            v-if="actorAside"
            :name="names[work.actorId!] ?? 'AI'"
            size="xs"
            :class="ring(work.actorId)"
          />
          <WorkStatus :activity="work" reply @open="taskWork?.open" @cancel="taskWork?.cancel" />
        </div>
        <!-- тред: ответы и поле ответа -->
        <slot />
      </div>
    </div>
  </div>
</template>
