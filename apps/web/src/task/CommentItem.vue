<script setup lang="ts">
import { shallowRef, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import { Avatar, Button } from '../ui';
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
}>();
const emit = defineEmits<{ save: [body: JSONContent]; remove: []; react: [emoji: string] }>();
const { t } = useI18n();
const editing = ref(false);
const draft = shallowRef<JSONContent | null>(null); // shallow: в IndexedDB нельзя класть reactive-прокси

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
  <div class="flex gap-2" data-testid="comment">
    <Avatar :name="author" :src="avatar" size="md" />
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2 text-sm">
        <span class="font-medium">{{ author }}</span>
        <time class="text-xs text-fg-subtle" :datetime="comment.createdAt">
          {{ new Date(comment.createdAt).toLocaleString() }}
        </time>
        <span v-if="comment.editedAt" class="text-xs text-fg-subtle">{{ t('task.edited') }}</span>
      </div>
      <template v-if="editing">
        <Editor v-model="draft" :members="members" :label="t('task.comment')" @submit="save" />
        <div class="mt-1 flex gap-2">
          <Button size="sm" variant="primary" @click="save">{{ t('task.save') }}</Button>
          <Button size="sm" variant="ghost" @click="editing = false">{{ t('task.cancel') }}</Button>
        </div>
      </template>
      <template v-else>
        <Editor
          :model-value="comment.body as JSONContent"
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
        <div v-if="mine" class="mt-1 flex gap-2">
          <Button size="sm" variant="ghost" data-testid="comment-edit" @click="start">
            {{ t('task.edit') }}
          </Button>
          <Button size="sm" variant="ghost" data-testid="comment-delete" @click="emit('remove')">
            {{ t('task.delete') }}
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>
