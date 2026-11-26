<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { AlertCircle } from '@lucide/vue';
import Tooltip from '../ui/Tooltip.vue';

// PLNRAPP-321: a compact AI status icon for a list row and a board card — a ring «ai» while the AI works,
// an error icon when the flow failed; the tooltip tells the state, the click opens the run (not the task)
export type AiStatus = 'running' | 'failed' | 'none';

const props = defineProps<{
  status: AiStatus;
  /** the page of the AI run: an app path (`/…`) or an absolute URL */
  runUrl: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorMessage?: string | null;
}>();

/** The error text in the tooltip is cut to this length. */
const ERROR_MAX = 120;

const { t, locale } = useI18n();
const time = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : null;
};
const label = computed(() => {
  if (props.status === 'running') {
    const at = time(props.startedAt);
    return at ? t('task.aiRunningSince', { time: at }) : t('task.aiRunning');
  }
  const at = time(props.finishedAt);
  const head = at ? t('task.aiFlowFailedAt', { time: at }) : t('task.aiFlowFailed');
  const err = props.errorMessage?.trim().replace(/\s+/g, ' ');
  if (!err) return head;
  return `${head}: ${err.length > ERROR_MAX ? `${err.slice(0, ERROR_MAX - 1)}…` : err}`;
});
const internal = computed(() => props.runUrl.startsWith('/') && !props.runUrl.startsWith('//'));
</script>

<template>
  <Tooltip v-if="status === 'running' || status === 'failed'" :content="label">
    <component
      :is="internal ? RouterLink : 'a'"
      v-bind="internal ? { to: runUrl } : { href: runUrl, target: '_blank', rel: 'noopener' }"
      :class="[
        'inline-flex size-5 shrink-0 items-center justify-center rounded-sm outline-none',
        'focus-visible:ring-2 ring-focus hover:bg-bg-muted',
        status === 'failed' ? 'text-danger' : 'text-fg-muted',
      ]"
      :aria-label="label"
      data-testid="ai-status"
      :data-state="status"
      @click.stop
      @keydown.enter.stop
    >
      <!-- a spinning ring with a still «ai» inside; the error — the icon alone -->
      <span
        v-if="status === 'running'"
        class="relative grid size-4 place-items-center"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          class="absolute inset-0 animate-spin motion-reduce:animate-none"
        >
          <path d="M21 12a9 9 0 1 1-6.22-8.56" />
        </svg>
        <span class="text-[7px] font-semibold leading-none">ai</span>
      </span>
      <AlertCircle v-else :size="14" aria-hidden="true" />
    </component>
  </Tooltip>
</template>
