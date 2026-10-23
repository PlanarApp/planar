<script setup lang="ts">
import { computed, ref } from 'vue';
import { mutate, newId, tr, useEstimate, useMyEntries, useNow, userId, useTasks } from './data';
import { clock, dayKey, hm, parseHm, subtreeIds, sumSec } from './lib';

const props = defineProps<{ taskId: string }>();
const now = useNow();
const entries = useMyEntries();
const tasks = useTasks();
const estimate = useEstimate(() => props.taskId);

const mine = computed(() => entries.value ?? []);
const ids = computed(() => subtreeIds(tasks.value ?? [], props.taskId));
const total = computed(() => sumSec(mine.value, ids.value, userId(), now.value));
const running = computed(() => mine.value.find((e) => !e.endedAt));
const runningHere = computed(() => running.value?.taskId === props.taskId);
const list = computed(() =>
  mine.value
    .filter((e) => e.taskId === props.taskId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
);
const estSec = computed(() => (estimate.value?.minutes ?? 0) * 60);
const over = computed(() => estSec.value > 0 && total.value > estSec.value);

const toggle = () =>
  runningHere.value
    ? mutate('time.stop', { id: running.value!.id })
    : mutate('time.start', { id: newId(), taskId: props.taskId });

const err = ref('');
const estInput = ref('');
const saveEstimate = async () => {
  const sec = parseHm(estInput.value);
  if (sec === null || sec % 60 || sec > 100000 * 60) return void (err.value = tr('invalid'));
  err.value = '';
  await mutate('time.setEstimate', { taskId: props.taskId, minutes: sec ? sec / 60 : null });
};

const day = ref(dayKey(new Date()));
const dur = ref('');
const note = ref('');
const add = async () => {
  const sec = parseHm(dur.value);
  if (!sec || sec > 86400 || !day.value) return void (err.value = tr('invalid'));
  err.value = '';
  const [y, m, d] = day.value.split('-').map(Number);
  await mutate('time.log', {
    id: newId(),
    taskId: props.taskId,
    startedAt: new Date(y, m - 1, d, 9).toISOString(),
    durationSec: sec,
    ...(note.value ? { note: note.value } : {}),
  });
  dur.value = note.value = '';
};
</script>

<template>
  <section class="tp">
    <div class="row">
      <button class="btn primary" data-test="toggle" @click="toggle">
        {{ runningHere ? tr('stop') : tr('start') }}
      </button>
      <span v-if="runningHere" class="mono" data-test="running">
        {{ clock(Math.floor((now - Date.parse(running!.startedAt)) / 1000)) }}
      </span>
    </div>
    <p data-test="sum">
      {{ tr('spent') }}: <b>{{ hm(total) || '0:00' }}</b>
      <small>({{ tr('withSub') }})</small>
      <template v-if="estSec">
        / {{ tr('estimate') }} {{ hm(estSec) }}
        <span :class="{ over }" data-test="vs">{{ Math.round((total / estSec) * 100) }}%</span>
      </template>
    </p>
    <label class="row">
      {{ tr('estimate') }}
      <input
        v-model="estInput"
        :placeholder="estimate ? hm(estimate.minutes * 60) : tr('estimateHint')"
        data-test="estimate"
        @change="saveEstimate"
      />
    </label>
    <form class="row" @submit.prevent="add">
      <input v-model="day" type="date" />
      <input v-model="dur" :placeholder="tr('estimateHint')" data-test="dur" />
      <input v-model="note" :placeholder="tr('note')" maxlength="1000" />
      <button class="btn" data-test="add">{{ tr('add') }}</button>
    </form>
    <p v-if="err" class="err" role="alert">{{ err }}</p>
    <h4>{{ tr('entries') }}</h4>
    <p v-if="!list.length" class="muted">{{ tr('noEntries') }}</p>
    <ul>
      <li v-for="e in list" :key="e.id" class="row" data-test="entry">
        <span>{{ e.startedAt.slice(0, 10) }}</span>
        <span class="mono">{{ e.endedAt ? hm(e.durationSec ?? 0) || '0:00' : '…' }}</span>
        <span class="muted grow">{{ e.note }}</span>
        <button class="btn" :aria-label="tr('del')" @click="mutate('time.delete', { id: e.id })">
          ×
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.tp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
  font-size: var(--text-base);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.grow {
  flex: 1;
}
.mono {
  font-family: var(--font-mono);
}
.muted {
  color: var(--color-fg-subtle);
}
.err,
.over {
  color: var(--color-danger);
}
input {
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-fg);
  padding: 4px 8px;
  min-width: 0;
}
.btn {
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-fg);
  padding: 4px 12px;
  min-height: 32px;
  cursor: pointer;
}
.btn.primary {
  background: var(--color-accent);
  color: var(--color-accent-fg);
  border-color: transparent;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
