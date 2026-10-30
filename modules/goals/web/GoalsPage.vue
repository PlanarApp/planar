<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button, FilterBuilder, Input, Select, useRouter } from '@planar/web/modules';
import type { Filter } from '@planar/shared';
import { goalProgress, krProgress, type KeyResult } from '../shared/index.js';
import { newId, rankBetween, run, text, useGoalsData, useSpaces } from './data';

const tx = computed(text);
const spaces = useSpaces();
// the selected space — in the address (?space=): after a reload, the same
const router = useRouter();
// without a router (page tests) — the selection is simply not remembered
const query = () => router?.currentRoute.value.query ?? {};
// space — «Reports» tab of the group: the space is set by the group, no choice
const props = defineProps<{ space?: string }>();
const spaceId = ref(
  props.space ?? (typeof query().space === 'string' ? (query().space as string) : ''),
);
watch(
  spaces,
  (s) => {
    if (!s?.length || props.space) return;
    if (!s.some((x) => x.id === spaceId.value)) spaceId.value = s[0].id;
  },
  { immediate: true },
);
watch(spaceId, (id) => {
  if (id && !props.space && query().space !== id)
    void router?.replace({ query: { ...query(), space: id } });
});
const data = useGoalsData(spaceId);
const archive = ref(false);

const shown = computed(() =>
  (data.value?.goals ?? []).filter((g) => !!g.archivedAt === archive.value),
);
const pr = (k: KeyResult) => (data.value ? krProgress(k, data.value.tasks, data.value.ctx) : 0);
const rowsOf = (goalId: string) =>
  (data.value?.krs ?? []).filter((k) => k.goalId === goalId).map((k) => ({ k, p: pr(k) }));
const pct = (x: number | null) => (x === null ? '' : `${Math.round(x * 100)}%`);

const goalName = ref('');
async function addGoal() {
  if (!goalName.value.trim()) return;
  const last = data.value?.goals.at(-1)?.rank ?? null;
  await run('goals.goal.create', {
    id: newId(),
    spaceId: spaceId.value,
    name: goalName.value.trim(),
    rank: rankBetween(last, null),
  });
  goalName.value = '';
}

// the form for a new key result (one, for the selected goal)
const form = ref<{
  goalId: string;
  name: string;
  kind: 'number' | 'tasks';
  start: string;
  target: string;
  unit: string;
  filter: Filter;
} | null>(null);
const openForm = (goalId: string) =>
  (form.value = {
    goalId,
    name: '',
    kind: 'number',
    start: '0',
    target: '100',
    unit: '',
    filter: { op: 'and', rules: [] },
  });
const formErr = ref('');
async function addKr() {
  const f = form.value;
  if (!f || !f.name.trim()) return;
  const [start, target] = [Number(f.start), Number(f.target)];
  if (
    f.kind === 'number' &&
    (!Number.isFinite(start) || !Number.isFinite(target) || start === target)
  )
    return void (formErr.value = tx.value.badMetric);
  formErr.value = '';
  const last = rowsOf(f.goalId).at(-1)?.k.rank ?? null;
  await run('goals.kr.create', {
    id: newId(),
    goalId: f.goalId,
    name: f.name.trim(),
    kind: f.kind,
    rank: rankBetween(last, null),
    ...(f.kind === 'number'
      ? { metric: { start, target, current: start, unit: f.unit.trim() || null } }
      : { filter: { projectIds: [], filter: f.filter } }),
  });
  form.value = null;
}
// the typed value is kept until change: a re-render (sync confirmation) does not overwrite the field
const drafts = ref<Record<string, string>>({});
const setCurrent = (k: KeyResult, v: string) => {
  delete drafts.value[k.id];
  const current = Number(v);
  if (k.metric && v !== '' && Number.isFinite(current))
    void run('goals.kr.update', { id: k.id, metric: { ...k.metric, current } });
};
</script>

<template>
  <section class="flex flex-col gap-4 p-4" data-testid="goals-page">
    <header class="flex flex-wrap items-end gap-2">
      <h1 class="text-lg font-medium">{{ tx.goals }}</h1>
      <Select
        v-if="!space"
        v-model="spaceId"
        :label="tx.space"
        :options="(spaces ?? []).map((s) => ({ value: s.id, label: s.name }))"
      />
      <Button size="sm" :variant="archive ? 'primary' : 'secondary'" @click="archive = !archive">
        {{ tx.showArchive }}
      </Button>
    </header>
    <form class="flex items-end gap-2" @submit.prevent="addGoal">
      <Input v-model="goalName" :label="tx.addGoal" />
      <Button type="submit" size="sm" data-testid="goal-create">{{ tx.create }}</Button>
    </form>
    <p v-if="data && !shown.length" class="text-fg-muted">{{ tx.empty }}</p>
    <article
      v-for="g in shown"
      :key="g.id"
      class="rounded-md border border-border p-3"
      data-testid="goal"
    >
      <header class="flex items-center gap-2">
        <h2 class="font-medium">{{ g.name }}</h2>
        <span v-if="g.dueDate" class="text-sm text-fg-muted">{{ g.dueDate }}</span>
        <span class="ml-auto text-sm" data-testid="goal-percent">
          {{ pct(goalProgress(rowsOf(g.id).map((r) => r.p))) }}
        </span>
        <Button
          size="sm"
          variant="secondary"
          @click="
            run('goals.goal.update', {
              id: g.id,
              archivedAt: g.archivedAt ? null : new Date().toISOString(),
            })
          "
        >
          {{ g.archivedAt ? tx.restore : tx.archive }}
        </Button>
        <Button size="sm" variant="secondary" @click="run('goals.goal.delete', { id: g.id })">
          {{ tx.del }}
        </Button>
      </header>
      <p v-if="!rowsOf(g.id).length" class="text-sm text-fg-muted">{{ tx.noKr }}</p>
      <div v-for="{ k, p } in rowsOf(g.id)" :key="k.id" class="my-2 text-sm" data-testid="kr">
        <div class="flex items-center gap-2">
          <span>{{ k.name }}</span>
          <template v-if="k.kind === 'number' && k.metric">
            <input
              type="number"
              class="w-24 rounded-sm border border-border bg-bg px-1"
              :aria-label="tx.current"
              :value="drafts[k.id] ?? k.metric.current"
              @input="drafts[k.id] = ($event.target as HTMLInputElement).value"
              @change="setCurrent(k, ($event.target as HTMLInputElement).value)"
            />
            <span class="text-fg-muted"> / {{ k.metric.target }} {{ k.metric.unit ?? '' }} </span>
          </template>
          <span class="ml-auto">{{ pct(p) }}</span>
          <Button size="sm" variant="secondary" @click="run('goals.kr.delete', { id: k.id })">
            {{ tx.del }}
          </Button>
        </div>
        <div class="mt-1 h-2 overflow-hidden rounded-full bg-bg-muted">
          <div class="h-full bg-accent" :style="{ width: p * 100 + '%' }" />
        </div>
      </div>
      <Button
        v-if="!g.archivedAt && form?.goalId !== g.id"
        size="sm"
        variant="secondary"
        @click="openForm(g.id)"
      >
        {{ tx.addKr }}
      </Button>
      <form
        v-else-if="form && form.goalId === g.id"
        class="mt-2 flex flex-wrap items-end gap-2"
        @submit.prevent="addKr"
      >
        <Input v-model="form.name" :label="tx.name" />
        <Select
          v-model="form.kind as string"
          :label="tx.kind"
          :options="[
            { value: 'number', label: tx.number },
            { value: 'tasks', label: tx.tasks },
          ]"
          @update:model-value="form.kind = $event as 'number' | 'tasks'"
        />
        <template v-if="form.kind === 'number'">
          <Input v-model="form.start" :label="tx.start" type="number" />
          <Input v-model="form.target" :label="tx.target" type="number" />
          <Input v-model="form.unit" :label="tx.unit" />
        </template>
        <FilterBuilder v-else v-model="form.filter" :space-id="spaceId" />
        <Button type="submit" size="sm">{{ tx.create }}</Button>
        <span v-if="formErr" role="alert" class="text-danger">{{ formErr }}</span>
      </form>
    </article>
  </section>
</template>
