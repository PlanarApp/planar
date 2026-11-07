<script setup lang="ts">
import { computed, shallowRef, ref } from 'vue';
import { MessageSquareReply, Pencil, Trash2, UserPlus } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import { Avatar, Button, IconButton, Menu, type MenuItem } from '../ui';
import Reactions from './Reactions.vue';
import Editor from './editor/Editor.vue';

const props = defineProps<{
  comment: Row<'comments'>;
  author: string;
  avatar?: string | null;
  assigneeAvatar?: string | null;
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
      <div class="flex items-start gap-2 text-sm">
        <!-- узкая колонка: время уходит под имя, а не блок назначения под заголовок -->
        <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span class="font-medium">{{ author }}</span>
          <time class="whitespace-nowrap text-xs text-fg-subtle" :datetime="comment.createdAt">
            {{ new Date(comment.createdAt).toLocaleString() }}
          </time>
          <span v-if="comment.editedAt" class="text-xs text-fg-subtle">{{ t('task.edited') }}</span>
        </div>
        <!-- назначенный комментарий: «завершено» и исполнитель — справа на строке заголовка (PLNRAPP-112) -->
        <div
          v-if="comment.assigneeId"
          class="flex h-5 shrink-0 items-center gap-2 whitespace-nowrap text-xs text-fg-muted"
          data-testid="comment-assigned"
        >
          <label class="inline-flex items-center gap-1">
            <input
              type="checkbox"
              :checked="!!comment.resolvedAt"
              :disabled="!canResolve"
              data-testid="comment-resolve"
              @change="emit('resolve', ($event.target as HTMLInputElement).checked)"
            />
            {{ t('task.resolved') }}
          </label>
          <span
            :class="['inline-flex items-center gap-1', comment.resolvedAt && 'line-through']"
            :aria-label="t('task.assignedTo', { name: names[comment.assigneeId] ?? '?' })"
          >
            {{ t('task.assigned') }}
            <Avatar :name="names[comment.assigneeId] ?? '?'" :src="assigneeAvatar" size="sm" />
          </span>
        </div>
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
          collapsible
        />
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
          <Menu v-if="root && members.length" :items="assignItems" align="start">
            <template #trigger>
              <IconButton
                size="sm"
                :icon="UserPlus"
                :label="t('task.assignComment')"
                data-testid="comment-assign"
              />
            </template>
          </Menu>
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
      <!-- тред: ответы и поле ответа -->
      <slot />
    </div>
  </div>
</template>
