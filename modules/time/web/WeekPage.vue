<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, IconButton, Input } from '@planar/web/modules';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { dayKey, entrySec, hm, parseHm, planCell, weekDays } from './lib';
import { locale, mutate, newId, tr, useMyEntries, useNow, useTasks, useWeekStart } from './data';

const weekStart = useWeekStart();
const now = useNow();
const entries = useMyEntries();
const tasks = useTasks();
const offset = ref(0);
const err = ref('');

const days = computed(() => {
  const a = new Date();
  a.setDate(a.getDate() + offset.value * 7);
  return weekDays(a, weekStart.value);
});
const keys = computed(() => days.value.map(dayKey));
const fmt = (d: Date) =>
  d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'numeric' });

// задача -> день -> записи
const grid = computed(() => {
  const g = new Map<string, Map<string, NonNullable<typeof entries.value>>>();
  for (const e of entries.value ?? []) {
    const k = dayKey(new Date(e.startedAt));
    if (!keys.value.includes(k)) continue;
    const row = g.get(e.taskId) ?? new Map();
    row.set(k, [...(row.get(k) ?? []), e]);
    g.set(e.taskId, row);
  }
  return g;
});
const rows = computed(() =>
  [...grid.value.keys()].map((id) => ({
    id,
    title: tasks.value?.find((t) => t.id === id)?.title ?? id.slice(0, 8),
  })),
);
const cell = (taskId: string, k: string) => grid.value.get(taskId)?.get(k) ?? [];
const cellSec = (taskId: string, k: string) =>
  cell(taskId, k).reduce((s, e) => s + entrySec(e, now.value), 0);
const rowTotal = (taskId: string) => keys.value.reduce((s, k) => s + cellSec(taskId, k), 0);
const dayTotal = (k: string) => rows.value.reduce((s, r) => s + cellSec(r.id, k), 0);
const grand = computed(() => keys.value.reduce((s, k) => s + dayTotal(k), 0));

async function edit(taskId: string, k: string, text: string) {
  const sec = parseHm(text);
  if (sec === null || sec > 86400) return void (err.value = tr('invalid'));
  err.value = '';
  const [y, m, d] = k.split('-').map(Number);
  const ops = planCell(cell(taskId, k), sec, new Date(y, m - 1, d, 9).toISOString(), newId, taskId);
  for (const op of ops) await mutate(op.name, op.args);
}
</script>

<template>
  <section class="wk">
    <header class="row">
      <h2>{{ tr('week') }}</h2>
      <IconButton :icon="ChevronLeft" :label="tr('prev')" data-test="prev" @click="offset--" />
      <IconButton :icon="ChevronRight" :label="tr('next')" data-test="next" @click="offset++" />
    </header>
    <p v-if="err" class="err" role="alert">{{ err }}</p>
    <p v-if="!rows.length" class="muted">{{ tr('empty') }}</p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th class="title">{{ tr('task') }}</th>
            <th v-for="(d, i) in days" :key="keys[i]" class="num" data-test="day">{{ fmt(d) }}</th>
            <th class="num">{{ tr('total') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" data-test="row">
            <td class="title">{{ r.title }}</td>
            <td v-for="k in keys" :key="k">
              <Input
                :model-value="hm(cellSec(r.id, k))"
                :label="`${r.title} ${k}`"
                hide-label
                size="sm"
                :class="['cell', cellSec(r.id, k) ? '' : 'empty']"
                :data-test="`cell-${r.id}-${k}`"
                @change="(e: Event) => edit(r.id, k, (e.target as HTMLInputElement).value)"
              />
            </td>
            <td class="num total">{{ hm(rowTotal(r.id)) }}</td>
          </tr>
        </tbody>
        <tfoot v-if="rows.length">
          <tr>
            <td class="title">{{ tr('total') }}</td>
            <td v-for="k in keys" :key="k" class="num">{{ hm(dayTotal(k)) }}</td>
            <td class="num total">{{ hm(grand) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>

<style scoped>
.wk {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--text-base);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
h2 {
  font-size: var(--text-xl);
  margin: 0;
  flex: 1;
}
.scroll {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  min-width: 640px;
}
th,
td {
  border-bottom: 1px solid var(--color-border);
  padding: 4px 6px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
th {
  color: var(--color-fg-muted);
  font-weight: 500;
}
.title {
  text-align: left;
  max-width: 24ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: var(--color-bg);
}
.total {
  font-weight: 500;
}
.muted {
  color: var(--color-fg-subtle);
}
.err {
  color: var(--color-danger);
}
.cell {
  width: 8ch;
  margin-left: auto;
}
.cell :deep(input) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
/* пустые ячейки — без рамки до наведения/фокуса */
.cell.empty :deep(input:not(:hover):not(:focus)) {
  border-color: transparent;
  background: transparent;
}
@media (max-width: 767px) {
  .title {
    position: sticky;
    left: 0;
    z-index: 1;
  }
}
</style>
