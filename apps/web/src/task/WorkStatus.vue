<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { AlertCircle } from 'lucide-vue-next';
import { minutesSince, useNow, type Activity } from '../modules/activity';

// PLNRAPP-202: the line of a module's background work (an AI run): «работает», «агент работает N мин»,
// «ждёт ответа», an error with a link to the run
const props = defineProps<{ activity: Activity; reply?: boolean }>();
const emit = defineEmits<{ open: [a: Activity] }>();
const { t } = useI18n();
const now = useNow();
const text = computed(() => {
  const a = props.activity;
  if (a.state === 'failed') return t('task.aiFailed');
  if (a.state === 'waiting_human') return t('task.aiWaiting');
  if (a.agent) return t('task.aiAgent', { n: minutesSince(a.startedAt, now.value) });
  return t(props.reply ? 'task.aiReplying' : 'task.aiWorking');
});
</script>

<template>
  <span
    :class="[
      'inline-flex flex-wrap items-center gap-1 text-xs',
      activity.state === 'failed' ? 'text-danger' : 'text-fg-muted',
    ]"
    role="status"
    data-testid="work-status"
    :data-state="activity.state"
  >
    <span v-if="activity.state === 'running'" class="work-dot" aria-hidden="true" />
    <AlertCircle v-else-if="activity.state === 'failed'" :size="12" aria-hidden="true" />
    {{ text }}
    <button
      v-if="activity.state === 'failed' && activity.panel"
      type="button"
      class="underline outline-none hover:text-fg focus-visible:ring-2 ring-focus rounded-sm"
      data-testid="work-open-run"
      @click="emit('open', activity)"
    >
      {{ t('task.aiOpenRun') }}
    </button>
  </span>
</template>
