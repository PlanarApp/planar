<script setup lang="ts">
import { computed, ref } from 'vue';
import { Play, Square } from 'lucide-vue-next';
import { IconButton, Popover } from '@planar/web/modules';
import TimerPanel from './TimerPanel.vue';
import { mutate, newId, tr, useMyEntries, useNow } from './data';
import { clock, hm } from './lib';

// task time as in ClickUp: start/stop on the left, my tracked time on the right;
// a click on the time — a menu with the new-entry form and the entries list (TimerPanel)
const props = defineProps<{ taskId: string }>();
const now = useNow();
const entries = useMyEntries();
const open = ref(false);

const running = computed(() => entries.value?.find((e) => !e.endedAt));
const runningHere = computed(() => running.value?.taskId === props.taskId);
// this task only (the menu shows the total with subtasks)
const total = computed(() =>
  (entries.value ?? [])
    .filter((e) => e.taskId === props.taskId)
    .reduce(
      (s, e) =>
        s +
        (e.endedAt
          ? (e.durationSec ?? 0)
          : Math.floor((now.value - Date.parse(e.startedAt)) / 1000)),
      0,
    ),
);
const shown = computed(() =>
  runningHere.value ? clock(Math.max(0, total.value)) : hm(total.value),
);

const toggle = () =>
  runningHere.value
    ? mutate('time.stop', { id: running.value!.id })
    : mutate('time.start', { id: newId(), taskId: props.taskId });
</script>

<template>
  <span class="tc" data-test="time-control" @click.stop>
    <IconButton
      size="sm"
      :icon="runningHere ? Square : Play"
      :label="runningHere ? tr('stop') : tr('start')"
      :active="runningHere"
      data-test="time-toggle"
      @click="toggle"
    />
    <Popover v-model:open="open" align="start">
      <template #trigger>
        <button
          type="button"
          :class="['time', runningHere && 'live', !shown && 'muted']"
          data-test="time-total"
        >
          {{ shown || tr('addManual') }}
        </button>
      </template>
      <div class="menu">
        <TimerPanel v-if="open" :task-id="taskId" menu />
      </div>
    </Popover>
  </span>
</template>

<style scoped>
.tc {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.time {
  border-radius: var(--radius-md, 6px);
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}
.time:hover {
  background: var(--color-bg-muted);
}
.live {
  color: var(--color-danger);
}
.muted {
  font-family: inherit;
  color: var(--color-fg-subtle);
}
.menu {
  width: 22rem;
  max-width: calc(100vw - 2rem);
}
</style>
