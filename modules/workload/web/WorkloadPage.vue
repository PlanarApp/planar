<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { compute, DEFAULT_CAPACITY, overloaded, weekList, type Cell, type Mode } from './lib';
import {
  mutate,
  newId,
  openTask,
  tr,
  useSpaces,
  useWorkloadData,
  useWeekStart,
  userId,
} from './data';

const weekStart = useWeekStart();
const spaces = useSpaces();
const spaceId = ref('');
watch(
  spaces,
  (s) => {
    if (!spaceId.value && s?.length) spaceId.value = s[0].id;
  },
  { immediate: true },
);
const data = useWorkloadData(() => spaceId.value);
const hasEst = computed(() => !!data.value?.estimates);
const pick = ref<Mode>('estimates');
const mode = computed<Mode>(() => (hasEst.value ? pick.value : 'count'));
const offset = ref(0);
const open = ref<{ user: string; week: string } | null>(null);

const weeks = computed(() => {
  const today = new Date();
  const d = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + offset.value * 7),
  );
  return weekList(d.toISOString().slice(0, 10), weekStart.value);
});
const grid = computed(() => {
  const d = data.value;
  if (!d) return new Map<string, Map<string, Cell>>();
  return compute({
    tasks: d.tasks,
    assignees: d.assignees,
    doneStatuses: new Set(
      d.statuses
        .filter((s) => s.category === 'done' || s.category === 'cancelled')
        .map((s) => s.id),
    ),
    estimates:
      mode.value === 'estimates'
        ? new Map(d.estimates!.map((e) => [e.taskId, e.minutes]))
        : undefined,
    weekStart: weekStart.value,
  });
});
const name = (id: string) => data.value?.users.find((u) => u.id === id)?.name ?? id.slice(0, 8);
const members = computed(() => (data.value?.members ?? []).map((m) => m.userId));
const isAdmin = computed(() =>
  data.value?.members.some((m) => m.userId === userId() && m.role === 'admin'),
);
const cap = (u: string) =>
  data.value?.caps.find((c) => c.userId === u)?.hoursPerWeek ?? DEFAULT_CAPACITY;
const cell = (u: string, w: string) => grid.value.get(u)?.get(w);
const over = (u: string, w: string) => mode.value === 'estimates' && overloaded(cell(u, w), cap(u));
const show = (c?: Cell) =>
  !c
    ? ''
    : mode.value === 'count'
      ? String(c.taskIds.length)
      : String(Math.round(c.hours * 10) / 10);
const list = computed(() => {
  const o = open.value;
  if (!o) return [];
  const ids = new Set(cell(o.user, o.week)?.taskIds);
  const key = (p: string) => data.value?.projects.find((x) => x.id === p)?.key ?? '?';
  return (data.value?.tasks ?? [])
    .filter((t) => ids.has(t.id))
    .map((t) => ({ id: t.id, title: t.title, key: `${key(t.projectId)}-${t.number}` }));
});
const setCap = (u: string, text: string) => {
  const n = text.trim() === '' ? null : Number(text);
  if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 168)) return;
  void mutate('workload.setCapacity', {
    id: newId(),
    spaceId: spaceId.value,
    userId: u,
    hoursPerWeek: n,
  });
};
</script>

<template>
  <section class="wl">
    <header class="row">
      <h2>{{ tr('title') }}</h2>
      <select v-model="spaceId" :aria-label="tr('space')" data-test="space">
        <option v-for="s in spaces ?? []" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <select v-if="hasEst" v-model="pick" :aria-label="tr('mode')" data-test="mode">
        <option value="estimates">{{ tr('estimates') }}</option>
        <option value="count">{{ tr('count') }}</option>
      </select>
      <button class="btn" :aria-label="tr('prev')" data-test="prev" @click="offset--">‹</button>
      <button class="btn" :aria-label="tr('next')" data-test="next" @click="offset++">›</button>
    </header>
    <p v-if="!spaces?.length" class="muted">{{ tr('empty') }}</p>
    <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>{{ tr('person') }}</th>
            <th>{{ tr('capacity') }}</th>
            <th v-for="w in weeks" :key="w" data-test="week">{{ w.slice(5) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in members" :key="u" data-test="row">
            <td class="who">{{ name(u) }}</td>
            <td>
              <input
                v-if="isAdmin"
                :value="cap(u)"
                :aria-label="`${tr('capacity')} ${name(u)}`"
                :data-test="`cap-${u}`"
                @change="setCap(u, ($event.target as HTMLInputElement).value)"
              />
              <span v-else>{{ cap(u) }}</span>
            </td>
            <td v-for="w in weeks" :key="w" :class="{ over: over(u, w) }">
              <button
                v-if="cell(u, w)"
                class="cell"
                :title="over(u, w) ? tr('overload') : ''"
                :data-test="`cell-${u}-${w}`"
                @click="open = { user: u, week: w }"
              >
                {{ show(cell(u, w)) }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <aside v-if="open" class="list" data-test="list">
      <header class="row">
        <h3>{{ tr('tasks') }}: {{ name(open.user) }}, {{ open.week }}</h3>
        <button class="btn" :aria-label="tr('close')" @click="open = null">×</button>
      </header>
      <ul>
        <li v-for="t in list" :key="t.id">
          <button class="link" data-test="task" @click="openTask(t.key)">
            {{ t.key }} {{ t.title }}
          </button>
        </li>
      </ul>
    </aside>
  </section>
</template>

<style scoped>
.wl {
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
h2,
h3 {
  font-size: var(--text-xl);
  margin: 0;
  flex: 1;
}
h3 {
  font-size: var(--text-base);
}
.scroll {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  min-width: 720px;
}
th,
td {
  border-bottom: 1px solid var(--color-border);
  padding: 4px 6px;
  text-align: center;
}
th {
  color: var(--color-fg-muted);
  font-weight: 500;
}
.who {
  text-align: left;
}
td.over {
  background: var(--color-danger-subtle);
  color: var(--color-danger);
}
input {
  width: 5ch;
  text-align: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-fg);
  padding: 4px;
}
.cell,
.link,
.btn {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.link {
  text-align: left;
}
.btn {
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  min-width: 32px;
  min-height: 32px;
}
.list {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 8px;
}
.muted {
  color: var(--color-fg-subtle);
}
</style>
