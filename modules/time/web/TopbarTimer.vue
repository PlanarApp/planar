<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '@planar/web/modules';
import { clock } from './lib';
import { mutate, tr, useMyEntries, useNow, useTasks } from './data';

const now = useNow();
const entries = useMyEntries();
const tasks = useTasks();
const running = computed(() => entries.value?.find((e) => !e.endedAt));
const title = computed(() => tasks.value?.find((t) => t.id === running.value?.taskId)?.title ?? '');
</script>

<template>
  <Button
    v-if="running"
    size="sm"
    data-test="topbar-timer"
    :title="`${tr('stop')}: ${title}`"
    @click="mutate('time.stop', { id: running!.id })"
  >
    <span class="dot" />
    <span class="mono">{{
      clock(Math.max(0, Math.floor((now - Date.parse(running.startedAt)) / 1000)))
    }}</span>
    <span class="name">{{ title }}</span>
  </Button>
</template>

<style scoped>
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-danger);
}
.mono {
  font-family: var(--font-mono);
}
.name {
  max-width: 12ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 640px) {
  .name {
    display: none;
  }
}
</style>
