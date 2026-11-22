<script setup lang="ts">
import { computed } from 'vue';
import { tr, useMrs } from './data';
import { CiFailed, MergeRequest } from './icons';

// On a list row / board card: open MRs, the CI of open MRs (running — a ring «ci», failed — the icon); nothing without GitLab data
const props = defineProps<{ taskId: string }>();
const mrs = useMrs(() => props.taskId);
const RUNNING = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running'];
const s = computed(() => {
  const open = (mrs.value ?? []).filter((m) => m.state === 'opened');
  const ci = open.map((m) => m.pipelineStatus);
  return {
    open: open.length,
    failed: ci.includes('failed'),
    running: ci.some((c) => !!c && RUNNING.includes(c)),
  };
});
const chip = 'inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-xs';
</script>

<template>
  <span class="inline-flex items-center gap-1">
    <span v-if="s.open" :class="[chip, 'text-fg-muted']" :title="tr('cardMrs')" data-testid="gl-mrs"
      ><MergeRequest :size="12" />{{ s.open }}</span
    >
    <span
      v-if="s.failed"
      class="inline-flex text-danger"
      role="img"
      :aria-label="tr('ciFailed')"
      :title="tr('ciFailed')"
      data-testid="gl-ci-failed"
      ><CiFailed :size="14"
    /></span>
    <span
      v-else-if="s.running"
      class="relative grid size-4 place-items-center text-fg-muted"
      role="img"
      :aria-label="tr('ciRunning')"
      :title="tr('ciRunning')"
      data-testid="gl-ci-running"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        class="absolute inset-0 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      >
        <path d="M21 12a9 9 0 1 1-6.22-8.56" />
      </svg>
      <span class="text-[7px] font-semibold leading-none" aria-hidden="true">ci</span>
    </span>
  </span>
</template>
