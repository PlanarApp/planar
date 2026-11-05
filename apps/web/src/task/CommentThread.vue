<script setup lang="ts">
import { inject, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { mutate } from '../sync';
import { Button } from '../ui';
import CommentItem from './CommentItem.vue';
import Editor from './editor/Editor.vue';
import { FEED } from './thread';

// a comment with its replies at any depth (PLANARAPP-45); only a root is assigned and resolved
const props = defineProps<{ comment: Row<'comments'>; depth?: number }>();
const { t } = useI18n();
const f = inject(FEED)!;
const c = () => props.comment;
const depth = () => props.depth ?? 0;
const box = ref<InstanceType<typeof Editor>>();
watch(
  () => f.replyTo.value === props.comment.id,
  async (on) => {
    if (!on) return;
    await nextTick();
    box.value?.focus?.();
  },
);
function startReply() {
  f.replyDraft.value = null;
  f.replyTo.value = props.comment.id;
}
</script>

<template>
  <CommentItem
    :comment="c()"
    :author="f.nameOf(c().authorId)"
    :avatar="f.avatarOf(c().authorId)"
    :mine="c().authorId === f.userId()"
    :reactions="(f.reactions.value ?? []).filter((r) => r.commentId === c().id)"
    :user-id="f.userId()"
    :names="f.names.value"
    :members="f.members.value"
    :root="!c().parentId"
    can-reply
    :can-resolve="!c().parentId && f.canResolve(c())"
    @react="(emoji) => f.react(c().id, emoji)"
    @save="(body) => mutate('comment.update', { id: c().id, body })"
    @remove="mutate('comment.delete', { id: c().id })"
    @reply="startReply"
    @assign="(u) => mutate('comment.assign', { id: c().id, assigneeId: u })"
    @resolve="(done) => mutate('comment.resolve', { id: c().id, resolved: done })"
  >
    <div
      v-if="f.replies.value.get(c().id)?.length || f.replyTo.value === c().id"
      :class="['mt-2 flex flex-col gap-2', depth() < 6 && 'border-l-2 border-border pl-3']"
      data-testid="thread"
    >
      <CommentThread
        v-for="r in f.replies.value.get(c().id) ?? []"
        :key="r.id"
        :comment="r"
        :depth="depth() + 1"
      />
      <div
        v-if="f.replyTo.value === c().id"
        class="rounded-md border border-border-strong bg-bg p-2"
        data-testid="reply-box"
      >
        <Editor
          ref="box"
          refs
          :model-value="f.replyDraft.value"
          :members="f.members.value"
          :label="t('task.replyPlaceholder')"
          :placeholder="t('task.replyPlaceholder')"
          @update:model-value="(v) => (f.replyDraft.value = v)"
          @submit="f.sendReply"
        />
        <div class="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" @click="f.replyTo.value = null">{{
            t('task.cancel')
          }}</Button>
          <Button
            size="sm"
            variant="primary"
            :disabled="!f.replyDraft.value"
            data-testid="reply-send"
            @click="f.sendReply"
            >{{ t('task.send') }}</Button
          >
        </div>
      </div>
    </div>
  </CommentItem>
</template>
