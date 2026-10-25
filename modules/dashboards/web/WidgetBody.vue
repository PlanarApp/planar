<script setup lang="ts">
import { computed } from 'vue';
import type { Widget } from '../shared/index.js';
import BarsChart from './BarsChart.vue';
import LineChart from './LineChart.vue';
import { compute, type Task } from './lib';
import { locale, openTask, tr, useFilterCtx, useNames, useWeekStart } from './data';

const props = defineProps<{ widget: Widget; tasks: Task[] }>();
const ctx = useFilterCtx();
const names = useNames();
const weekStart = useWeekStart();
const res = computed(
  () => ctx.value && compute(props.widget, props.tasks, ctx.value, new Date(), weekStart.value),
);

const label = (key: string): string => {
  const g = (props.widget.config as { groupBy?: string }).groupBy;
  if (!key) return tr('noValue');
  if (g === 'priority') return key === '0' ? tr('noValue') : `P${key}`;
  return names.value[key] ?? key;
};
const bars = computed(() =>
  res.value?.kind === 'bars' ? res.value.bars.map((b) => ({ label: label(b.key), n: b.n })) : [],
);
const fmt = (iso: string) => new Date(iso).toLocaleDateString(locale());
</script>

<template>
  <p v-if="!res" class="muted">{{ tr('loading') }}</p>
  <p v-else-if="res.kind === 'number'" class="num" data-test="number">{{ res.value }}</p>
  <template v-else-if="res.kind === 'bars'">
    <p v-if="!bars.length" class="muted">{{ tr('empty') }}</p>
    <BarsChart v-else :bars="bars" />
  </template>
  <LineChart v-else-if="res.kind === 'line'" :points="res.points" />
  <template v-else>
    <p v-if="!res.tasks.length" class="muted">{{ tr('empty') }}</p>
    <ul v-else class="list">
      <li v-for="t in res.tasks" :key="t.id" data-test="item">
        <button class="link" @click="openTask(t.id)">{{ t.title }}</button>
        <span v-if="t.dueDate" class="muted">{{ fmt(t.dueDate) }}</span>
      </li>
    </ul>
  </template>
</template>

<style scoped>
.muted {
  color: var(--color-fg-muted);
  font-size: var(--text-sm);
  margin: 0;
}
.num {
  font-size: 40px;
  font-weight: 600;
  margin: 0;
  line-height: 1.1;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--text-sm);
}
.list li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.link {
  all: unset;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.link:hover {
  color: var(--color-accent);
}
</style>
