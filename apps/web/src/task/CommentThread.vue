<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, ChevronRight } from 'lucide-vue-next';
import { docText } from '../command/search';
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
// collapsed (PLANARAPP-44): one line — author, text, replies of the whole subtree, assignment and its state
const collapsed = ref(false);
const descendants = computed(() => {
  let n = 0;
  const q = [props.comment.id];
  while (q.length) {
    const kids = f.replies.value.get(q.pop()!) ?? [];
    n += kids.length;
    q.push(...kids.map((k) => k.id));
  }
  return n;
});
const snippet = computed(() => docText(props.comment.body).replace(/\s+/g, ' ').trim());
</script>

<template>
  <div class="flex gap-1" :data-collapsed="collapsed || undefined">
    <button
      type="button"
      class="mt-2 flex size-5 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
      :aria-expanded="!collapsed"
      :aria-label="t(collapsed ? 'task.expandComment' : 'task.collapseComment')"
      data-testid="comment-fold"
      @click="collapsed = !collapsed"
    >
      <component :is="collapsed ? ChevronRight : ChevronDown" :size="14" />
    </button>
    <button
      v-if="collapsed"
      type="button"
      class="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-sm hover:bg-bg-muted"
      :data-comment="c().id"
      data-testid="comment-collapsed"
      @click="collapsed = false"
    >
      <span class="shrink-0 font-medium">{{ f.nameOf(c().authorId) }}</span>
      <span class="min-w-0 flex-1 truncate text-fg-muted">{{ snippet }}</span>
      <span
        v-if="c().assigneeId"
        :class="[
          'shrink-0 rounded-full px-2 py-0.5 text-xs',
          c().resolvedAt ? 'bg-bg-muted text-fg-muted line-through' : 'bg-accent-subtle text-fg',
        ]"
        data-testid="collapsed-assigned"
        >{{ t('task.assignedTo', { name: f.names.value[c().assigneeId!] ?? '?' })
        }}<template v-if="c().resolvedAt"> · {{ t('task.resolved') }}</template></span
      >
      <span v-if="descendants" class="shrink-0 text-xs text-fg-subtle">{{
        t('task.repliesCount', { n: descendants })
      }}</span>
    </button>
    <CommentItem
      v-else
      class="min-w-0 flex-1"
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
            image
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
  </div>
</template>
