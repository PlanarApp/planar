<script setup lang="ts">
import { computed } from 'vue';
import { tr, type Key } from './data';
import { CiFailed, CiOther, CiPassed, CiPending } from './icons';

// PLNRAPP-822: the status of a branch's last pipeline; a click opens its job in GitLab in a new tab
const props = defineProps<{ status: string; url?: string | null }>();
const RUNNING = ['created', 'waiting_for_resource', 'preparing', 'pending', 'running'];
const KNOWN = [...RUNNING, 'success', 'failed', 'canceled', 'skipped', 'manual', 'scheduled'];
// only http(s): the link comes from an external system
const href = computed(() => (props.url && /^https?:\/\//i.test(props.url) ? props.url : undefined));
const label = computed(() =>
  KNOWN.includes(props.status) ? tr(`ci_${props.status}` as Key) : props.status,
);
const kind = computed(() =>
  props.status === 'success'
    ? 'ok'
    : props.status === 'failed'
      ? 'fail'
      : RUNNING.includes(props.status)
        ? 'run'
        : 'other',
);
const tone = computed(
  () =>
    ({ ok: 'text-success', fail: 'text-danger', run: 'text-accent', other: 'text-fg-subtle' })[
      kind.value
    ],
);
</script>

<template>
  <component
    :is="href ? 'a' : 'span'"
    :href="href"
    :target="href ? '_blank' : undefined"
    :rel="href ? 'noopener noreferrer' : undefined"
    :class="['inline-flex shrink-0 items-center gap-1 text-xs', tone, href && 'hover:underline']"
    :title="`${tr('ciStatus')}: ${label}`"
    :data-status="status"
    data-testid="gl-ci"
  >
    <CiPassed v-if="kind === 'ok'" :size="12" />
    <CiFailed v-else-if="kind === 'fail'" :size="12" />
    <CiPending
      v-else-if="kind === 'run'"
      :size="12"
      class="animate-spin motion-reduce:animate-none"
    />
    <CiOther v-else :size="12" />
    {{ label }}
  </component>
</template>
