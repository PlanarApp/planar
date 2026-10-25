<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Input } from '@planar/web/modules';
import { milestoneProgress, type StatusCategory } from '../shared/index.js';
import { newId, openTask, run, text, useMilestoneData } from './data';

const props = defineProps<{ projectId: string }>();
const tx = computed(text);
const data = useMilestoneData(() => props.projectId);
const name = ref('');
const date = ref('');

const CATS: StatusCategory[] = ['done', 'in_progress', 'todo', 'backlog', 'cancelled'];
const BAR: Record<StatusCategory, string> = {
  done: 'bg-success',
  in_progress: 'bg-accent',
  todo: 'bg-fg-subtle',
  backlog: 'bg-border',
  cancelled: 'bg-bg-muted',
};

const rows = computed(() => {
  const d = data.value;
  if (!d) return [];
  const cat = new Map(d.statuses.map((s) => [s.id, s.category as StatusCategory]));
  const task = new Map(d.tasks.map((t) => [t.id, t]));
  return d.milestones.map((m) => {
    const ts = d.links
      .filter((l) => l.milestoneId === m.id)
      .flatMap((l) => {
        const t = task.get(l.taskId);
        return t ? [{ t, category: cat.get(t.statusId) ?? ('backlog' as StatusCategory) }] : [];
      });
    return { m, ts, p: milestoneProgress(ts) };
  });
});

async function add() {
  if (!name.value.trim() || !date.value) return;
  await run('goals.milestone.create', {
    id: newId(),
    projectId: props.projectId,
    name: name.value.trim(),
    date: date.value,
  });
  name.value = '';
}
</script>

<template>
  <section class="flex flex-col gap-4 p-4" data-testid="milestones">
    <form class="flex items-end gap-2" @submit.prevent="add">
      <Input v-model="name" :label="tx.name" />
      <Input v-model="date" :label="tx.date" type="date" />
      <Button type="submit" size="sm" data-testid="ms-create">{{ tx.create }}</Button>
    </form>
    <p v-if="data && !rows.length" class="text-fg-muted">{{ tx.empty }}</p>
    <article
      v-for="{ m, ts, p } in rows"
      :key="m.id"
      class="rounded-md border border-border p-3"
      data-testid="ms-row"
    >
      <header class="flex items-center gap-2">
        <h3 class="font-medium">{{ m.name }}</h3>
        <span class="text-sm text-fg-muted">{{ m.date }}</span>
        <span class="ml-auto text-sm" data-testid="ms-percent"
          >{{ Math.round(p.done * 100) }}%</span
        >
        <Button size="sm" variant="secondary" @click="run('goals.milestone.delete', { id: m.id })">
          {{ tx.del }}
        </Button>
      </header>
      <div class="my-2 flex h-2 overflow-hidden rounded-full bg-bg-muted" role="img">
        <span
          v-for="c in CATS"
          :key="c"
          :class="BAR[c]"
          :style="{ width: (ts.length ? (p.counts[c] / ts.length) * 100 : 0) + '%' }"
          :title="`${tx.cat[c]}: ${p.counts[c]}`"
        />
      </div>
      <ul class="text-sm">
        <li v-for="x in ts" :key="x.t.id">
          <button class="hover:underline" @click="openTask(`${data!.projectKey}-${x.t.number}`)">
            {{ data!.projectKey }}-{{ x.t.number }} {{ x.t.title }}
          </button>
          <span class="ml-2 text-fg-subtle">{{ tx.cat[x.category] }}</span>
        </li>
      </ul>
    </article>
  </section>
</template>
