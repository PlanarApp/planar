<script setup lang="ts">
import { computed } from 'vue';
import { tr, useMrs } from './data';
import { GitBranch, MergeRequest } from './icons';

const props = defineProps<{ taskId: string }>();
const mrs = useMrs(() => props.taskId);
const list = computed(() =>
  [...(mrs.value ?? [])].sort((a, b) => b.mrUpdatedAt.localeCompare(a.mrUpdatedAt)),
);
// only http(s): webUrl comes from an external system
const safe = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);
const tone = (state: string) =>
  state === 'merged' ? 'text-success' : state === 'opened' ? 'text-accent' : 'text-fg-subtle';
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="gl-panel">
    <p v-if="!list.length" class="text-sm text-fg-muted">{{ tr('noMrs') }}</p>
    <ul v-else class="flex flex-col gap-2">
      <li v-for="m in list" :key="m.id" class="flex flex-col gap-0.5 text-sm" data-testid="gl-mr">
        <div class="flex items-center gap-2">
          <MergeRequest :size="14" :class="['shrink-0', tone(m.state)]" />
          <a
            :href="safe(m.webUrl)"
            target="_blank"
            rel="noopener noreferrer"
            class="min-w-0 truncate font-medium underline"
          >
            !{{ m.iid }} {{ m.title }}
          </a>
          <span :class="['text-xs', tone(m.state)]" :data-state="m.state" data-testid="gl-state">{{
            tr(m.state)
          }}</span>
        </div>
        <div class="flex items-center gap-2 text-xs text-fg-muted" data-testid="gl-branch">
          <GitBranch :size="14" :class="['shrink-0', tone(m.state)]" />
          <span class="min-w-0 truncate font-mono">{{ m.sourceBranch }}</span>
          <span :class="tone(m.state)">{{
            tr(m.state === 'merged' ? 'branchMerged' : 'branchOpen')
          }}</span>
        </div>
      </li>
    </ul>
  </section>
</template>
