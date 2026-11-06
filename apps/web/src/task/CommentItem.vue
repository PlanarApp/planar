<script setup lang="ts">
import { computed, shallowRef, ref } from 'vue';
import { MessageSquareReply, UserPlus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import { Avatar, Button, Menu, type MenuItem } from '../ui';
import Reactions from './Reactions.vue';
import Editor from './editor/Editor.vue';

const props = defineProps<{
  comment: Row<'comments'>;
  author: string;
  avatar?: string | null;
  mine: boolean;
  members: { id: string; name: string }[];
  reactions: Row<'commentReactions'>[];
  userId?: string;
  names: Record<string, string>;
  /** thread root: can be assigned and resolved */
  root?: boolean;
  /** "Reply" — on any comment (replies at any depth) */
  canReply?: boolean;
  /** assigned root: the assignee, author or admin can resolve */
  canResolve?: boolean;
}>();
const emit = defineEmits<{
  save: [body: JSONContent];
  remove: [];
  react: [emoji: string];
  reply: [];
  assign: [userId: string | null];
  resolve: [done: boolean];
}>();
const assignItems = computed<MenuItem[]>(() => [
  ...props.members.map((m) => ({
    id: m.id,
    label: m.name,
    onSelect: () => emit('assign', m.id),
  })),
  ...(props.comment.assigneeId
    ? [
        { separator: true as const },
        { id: 'none', label: t('task.unassignComment'), onSelect: () => emit('assign', null) },
      ]
    : []),
]);
const { t } = useI18n();
const editing = ref(false);
const draft = shallowRef<JSONContent | null>(null); // shallow: reactive proxies can't be stored in IndexedDB

function start() {
  draft.value = props.comment.body as JSONContent;
  editing.value = true;
}
function save() {
  if (!draft.value) return;
  emit('save', draft.value);
  editing.value = false;
}
</script>

<template>
  <div class="flex gap-2" data-testid="comment" :data-comment="comment.id">
    <Avatar :name="author" :src="avatar" size="md" />
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2 text-sm">
        <span class="font-medium">{{ author }}</span>
        <time class="text-xs text-fg-subtle" :datetime="comment.createdAt">
          {{ new Date(comment.createdAt).toLocaleString() }}
        </time>
        <span v-if="comment.editedAt" class="text-xs text-fg-subtle">{{ t('task.edited') }}</span>
      </div>
      <!-- назначенный комментарий: исполнитель и «завершено» -->
      <div
        v-if="comment.assigneeId"
        class="mt-1 flex items-center gap-2 text-xs"
        data-testid="comment-assigned"
      >
        <span
          :class="[
            'rounded-full px-2 py-0.5',
            comment.resolvedAt
              ? 'bg-bg-muted text-fg-muted line-through'
              : 'bg-accent-subtle text-fg',
          ]"
          >{{ t('task.assignedTo', { name: names[comment.assigneeId] ?? '?' }) }}</span
        >
        <label class="inline-flex items-center gap-1 text-fg-muted">
          <input
            type="checkbox"
            :checked="!!comment.resolvedAt"
            :disabled="!canResolve"
            data-testid="comment-resolve"
            @change="emit('resolve', ($event.target as HTMLInputElement).checked)"
          />
          {{ t('task.resolved') }}
        </label>
      </div>
      <template v-if="editing">
        <Editor
          v-model="draft"
          refs
          image
          :members="members"
          :label="t('task.comment')"
          @submit="save"
        />
        <div class="mt-1 flex gap-2">
          <Button size="sm" variant="primary" @click="save">{{ t('task.save') }}</Button>
          <Button size="sm" variant="ghost" @click="editing = false">{{ t('task.cancel') }}</Button>
        </div>
      </template>
      <template v-else>
        <Editor
          :model-value="comment.body as JSONContent"
          image
          :members="members"
          :label="t('task.comment')"
          :editable="false"
        />
        <Reactions
          :rows="reactions"
          :user-id="userId"
          :names="names"
          @toggle="(emoji) => emit('react', emoji)"
        />
        <div class="mt-1 flex flex-wrap gap-1">
          <Button
            v-if="canReply"
            size="sm"
            variant="ghost"
            :icon="MessageSquareReply"
            data-testid="comment-reply"
            @click="emit('reply')"
          >
            {{ t('task.reply') }}
          </Button>
          <Menu v-if="root && members.length" :items="assignItems" align="start">
            <template #trigger>
              <Button size="sm" variant="ghost" :icon="UserPlus" data-testid="comment-assign">
                {{ t('task.assignComment') }}
              </Button>
            </template>
          </Menu>
          <template v-if="mine">
            <Button size="sm" variant="ghost" data-testid="comment-edit" @click="start">
              {{ t('task.edit') }}
            </Button>
            <Button size="sm" variant="ghost" data-testid="comment-delete" @click="emit('remove')">
              {{ t('task.delete') }}
            </Button>
          </template>
        </div>
      </template>
      <!-- тред: ответы и поле ответа -->
      <slot />
    </div>
  </div>
</template>
