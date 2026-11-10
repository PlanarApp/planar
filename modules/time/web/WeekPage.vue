<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, IconButton, Input, Select, type GroupScope } from '@planar/web/modules';
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { dayKey, entrySec, hm, parseHm, planCell, weekDays } from './lib';
import TimeExport from './TimeExport.vue';
import {
  isInstanceAdmin,
  locale,
  mutate,
  newId,
  tr,
  useEntries,
  useNow,
  useTasks,
  useUsers,
  useWeekStart,
  userId,
} from './data';

// scope — «Reports › Time» tab of the group: only tasks of its level and nested ones
const props = defineProps<{ scope?: GroupScope }>();
const weekStart = useWeekStart();
const now = useNow();
const admin = computed(isInstanceAdmin);
const users = useUsers();
const who = ref(userId());
const mine = computed(() => who.value === userId());
const all = useEntries(() => who.value);
const tasks = useTasks();
const inScope = computed(() => {
  const s = props.scope;
  if (!s || s.level === 'workspace') return () => true;
  const ok = new Set(
    (tasks.value ?? [])
      .filter((t) => (s.projectId ? t.projectId === s.projectId : t.spaceId === s.spaceId))
      .map((t) => t.id),
  );
  return (id: string) => ok.has(id);
});
const entries = computed(() => all.value?.filter((e) => inScope.value(e.taskId)));
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

// task -> day -> entries
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
      <Select
        v-if="admin"
        v-model="who"
        size="sm"
        :label="tr('user')"
        :options="(users ?? []).map((u) => ({ value: u.id, label: u.name }))"
        data-test="user"
      />
      <TimeExport :from="keys[0]" :to="keys[6]" :in-scope="inScope" />
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
                :disabled="!mine"
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
  /* in a flex container of the group tab the wide table would stretch the page instead of scrolling (PLNRAPP-151) */
  min-width: 0;
}
.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
h2 {
  font-size: var(--text-xl);
  margin: 0;
  flex: 1;
}
/* relative: the cells' sr-only labels (position: absolute) are clipped here instead of widening the page */
.scroll {
  position: relative;
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
/* empty cells — no border until hover/focus */
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
