<script setup lang="ts">
import { computed, ref } from 'vue';
import { CheckCircle2, ChevronRight, Circle } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { useAuth } from '../auth/useAuth';
import { useAdminSpaces } from '../screens/settings/shared';
import { docText } from '../command/search';
import { mutate } from '../sync';
import { useUsers } from './queries';

// PLNRAPP-561: the task's assigned comments (replies too, as GET /tasks/:task/assigned-comments) —
// open on top by createdAt, the resolved ones in a collapsed accordion
const props = defineProps<{ comments: Row<'comments'>[] }>();
const emit = defineEmits<{ open: [commentId: string] }>();
const { t } = useI18n();
const users = useUsers();
const name = (id: string | null) => users.value?.find((u) => u.id === id)?.name ?? '?';
const open = computed(() => props.comments.filter((c) => !c.resolvedAt));
const resolved = computed(() => props.comments.filter((c) => !!c.resolvedAt));
// PLNRAPP-562: «Resolve» right in the tab — the same mutation and rights as the feed (CommentItem):
// the assignee, the author or an admin; the list, the accordion and the counter follow the replica at once
const { user } = useAuth();
// comment.resolve: the assignee, the author or an admin of the comment's space (the mutator's rule)
const isSpaceAdmin = useAdminSpaces();
const canResolve = (c: Row<'comments'>) =>
  !!user.value &&
  (c.assigneeId === user.value.id || c.authorId === user.value.id || isSpaceAdmin(c.spaceId));
const resolve = (c: Row<'comments'>) =>
  mutate('comment.resolve', { id: c.id, resolved: !c.resolvedAt });
// collapsed on every opening of the card, as the subtasks' "Closed N" (PLNRAPP-542)
const showResolved = ref(false);
const groups = computed(() => [
  { key: 'open', rows: open.value, shown: true },
  { key: 'resolved', rows: resolved.value, shown: showResolved.value },
]);
</script>

<template>
  <section :aria-label="t('task.assignedComments')" data-testid="assigned-comments">
    <template v-for="g in groups" :key="g.key">
      <button
        v-if="g.key === 'resolved' && g.rows.length"
        type="button"
        class="mb-1 flex items-center gap-1 rounded px-1 py-0.5 text-xs text-fg-muted hover:text-fg"
        :aria-expanded="showResolved"
        data-testid="assigned-resolved"
        @click="showResolved = !showResolved"
      >
        <ChevronRight
          :size="12"
          :class="['shrink-0 transition-transform', showResolved && 'rotate-90']"
        />{{ t('task.assignedResolved', { n: g.rows.length }) }}
      </button>
      <ul
        v-if="g.shown && g.rows.length"
        class="mb-1 overflow-hidden rounded-lg border border-border [&>*:last-child]:border-b-0"
        :data-testid="`assigned-${g.key}-list`"
      >
        <li v-for="c in g.rows" :key="c.id" class="flex items-start border-b border-border">
          <button
            type="button"
            class="mt-1 ml-1.5 shrink-0 rounded p-0.5 outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus disabled:cursor-default disabled:hover:bg-transparent"
            :class="c.resolvedAt ? 'text-success' : 'text-fg-muted hover:text-fg'"
            :aria-label="t(c.resolvedAt ? 'task.resolved' : 'task.resolve')"
            :title="t(c.resolvedAt ? 'task.resolved' : 'task.resolve')"
            :aria-pressed="!!c.resolvedAt"
            :disabled="!canResolve(c)"
            data-testid="assigned-resolve"
            @click="resolve(c)"
          >
            <CheckCircle2 v-if="c.resolvedAt" :size="16" />
            <Circle v-else :size="16" />
          </button>
          <button
            type="button"
            class="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-1.5 text-left text-sm outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
            :data-comment-id="c.id"
            @click="emit('open', c.id)"
          >
            <span
              :class="['truncate', c.resolvedAt && 'text-fg-muted']"
              data-testid="assigned-text"
              >{{ docText(c.body).trim() }}</span
            >
            <span class="truncate text-xs text-fg-subtle" data-testid="assigned-meta">
              <span :class="c.resolvedAt ? 'text-success' : 'text-accent'">{{
                t(c.resolvedAt ? 'task.resolved' : 'task.assignedOpen')
              }}</span>
              · {{ name(c.authorId) }} → {{ name(c.assigneeId) }} ·
              <time :datetime="c.createdAt">{{ new Date(c.createdAt).toLocaleString() }}</time>
            </span>
          </button>
        </li>
      </ul>
    </template>
  </section>
</template>
