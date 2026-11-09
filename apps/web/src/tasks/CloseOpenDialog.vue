<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CheckCircle2, Circle } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { Button, Dialog } from '../ui';
import { db, mutate, useQuery } from '../sync';
import { docText } from '../command/search';
import StatusPicker from './fields/StatusPicker.vue';
import { closeAll, closePrompt } from './closeOpen';

// completing a task with open subtasks / assigned comments (PLNRAPP-138): close them here, all at once, or leave
const { t } = useI18n();
const p = computed(() => closePrompt.value!);
// live rows of the captured ids: what is closed here shows as closed
const subtasks = useQuery(async () =>
  (await db.table<Row<'tasks'>>('tasks').bulkGet(p.value.subtaskIds)).filter(
    (x): x is Row<'tasks'> => !!x,
  ),
);
const comments = useQuery(async () =>
  (await db.table<Row<'comments'>>('comments').bulkGet(p.value.commentIds)).filter(
    (x): x is Row<'comments'> => !!x,
  ),
);
const users = useQuery(() => db.table<Row<'users'>>('users').toArray());
const nameOf = (id: string | null) => users.value?.find((u) => u.id === id)?.name ?? '?';
const all = async () => {
  await closeAll(p.value);
  p.value.answer(true);
};
</script>

<template>
  <Dialog
    :open="true"
    size="md"
    :title="t('closeOpen.title', { title: p.task.title })"
    :description="t('closeOpen.text')"
    @update:open="(o: boolean) => o || p.answer(false)"
  >
    <div class="flex max-h-[50vh] flex-col gap-3 overflow-y-auto" data-testid="close-open">
      <section v-if="subtasks?.length">
        <h3 class="mb-1 text-xs font-medium text-fg-muted">{{ t('closeOpen.subtasks') }}</h3>
        <div
          v-for="s in subtasks"
          :key="s.id"
          class="flex min-h-9 items-center gap-2"
          data-testid="close-open-subtask"
        >
          <StatusPicker
            compact
            :space-id="s.spaceId"
            :project-id="s.projectId"
            :model-value="s.statusId"
            @update:model-value="
              (v?: string) => v && mutate('task.update', { id: s.id, statusId: v })
            "
          />
          <span class="min-w-0 flex-1 truncate text-sm">{{ s.title }}</span>
        </div>
      </section>
      <section v-if="comments?.length">
        <h3 class="mb-1 text-xs font-medium text-fg-muted">{{ t('closeOpen.comments') }}</h3>
        <div
          v-for="c in comments"
          :key="c.id"
          class="flex min-h-9 items-center gap-2"
          data-testid="close-open-comment"
        >
          <button
            type="button"
            :aria-label="t('task.resolved')"
            :aria-pressed="!!c.resolvedAt"
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg outline-none focus-visible:ring-2 ring-focus"
            @click="mutate('comment.resolve', { id: c.id, resolved: !c.resolvedAt })"
          >
            <CheckCircle2 v-if="c.resolvedAt" :size="18" class="text-success" />
            <Circle v-else :size="18" />
          </button>
          <span class="shrink-0 text-xs text-fg-subtle">{{ nameOf(c.assigneeId) }}</span>
          <span
            :class="[
              'min-w-0 flex-1 truncate text-sm',
              c.resolvedAt && 'text-fg-muted line-through',
            ]"
            >{{ docText(c.body) }}</span
          >
        </div>
      </section>
    </div>
    <template #footer>
      <Button @click="p.answer(false)">{{ t('ui.cancel') }}</Button>
      <Button data-testid="close-open-only" @click="p.answer(true)">{{
        t('closeOpen.onlyTask')
      }}</Button>
      <Button variant="primary" data-testid="close-open-all" @click="all">{{
        t('closeOpen.closeAll')
      }}</Button>
    </template>
  </Dialog>
</template>
