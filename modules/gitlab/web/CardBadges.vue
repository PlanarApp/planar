<script setup lang="ts">
import { computed } from 'vue';
import { tr, useBranches, useMrs } from './data';
import { Branch, CiFailed, CiRunning, MergeRequest } from './icons';

// On a list row / board card: branches, MRs «open/merged», the CI of open MRs (running / failed); nothing without GitLab data
const props = defineProps<{ taskId: string }>();
const mrs = useMrs(() => props.taskId);
const branches = useBranches(() => props.taskId);
const RUNNING = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running'];
const s = computed(() => {
  const list = mrs.value ?? [];
  const open = list.filter((m) => m.state === 'opened');
  const ci = open.map((m) => m.pipelineStatus);
  return {
    branches: new Set([
      ...(branches.value ?? []).map((b) => b.name),
      ...list.map((m) => m.sourceBranch),
    ]).size,
    mrs: list.length,
    open: open.length,
    merged: list.filter((m) => m.state === 'merged').length,
    failed: ci.includes('failed'),
    running: ci.some((c) => !!c && RUNNING.includes(c)),
  };
});
const chip = 'inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-xs';
</script>

<template>
  <span class="inline-flex items-center gap-1">
    <span
      v-if="s.branches"
      :class="[chip, 'text-fg-muted']"
      :title="tr('cardBranches')"
      data-testid="gl-branches"
      ><Branch :size="12" />{{ s.branches }}</span
    >
    <span v-if="s.mrs" :class="[chip, 'text-fg-muted']" :title="tr('cardMrs')" data-testid="gl-mrs"
      ><MergeRequest :size="12" />{{ s.open }}/{{ s.merged }}</span
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
      class="inline-flex text-fg-muted"
      role="img"
      :aria-label="tr('ciRunning')"
      :title="tr('ciRunning')"
      data-testid="gl-ci-running"
      ><CiRunning :size="14" class="animate-spin motion-reduce:animate-none"
    /></span>
  </span>
</template>
