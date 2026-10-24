<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button, Input, Menu } from '@planar/web/modules';
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
      <Button variant="primary" data-test="toggle" @click="toggle">
        {{ runningHere ? tr('stop') : tr('start') }}
      </Button>
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
    <Input
      v-model="estInput"
      :label="tr('estimate')"
      :placeholder="estimate ? hm(estimate.minutes * 60) : tr('estimateHint')"
      data-test="estimate"
      @change="saveEstimate"
    />
    <form class="row" @submit.prevent="add">
      <Input v-model="day" type="date" :label="tr('day')" hide-label />
      <Input
        v-model="dur"
        :label="tr('estimateHint')"
        hide-label
        :placeholder="tr('estimateHint')"
        data-test="dur"
      />
      <Input v-model="note" :label="tr('note')" hide-label :placeholder="tr('note')" class="grow" />
      <Button type="submit" data-test="add">{{ tr('add') }}</Button>
    </form>
    <p v-if="err" class="err" role="alert">{{ err }}</p>
    <h4>{{ tr('entries') }}</h4>
    <p v-if="!list.length" class="muted">{{ tr('noEntries') }}</p>
    <ul>
      <li v-for="e in list" :key="e.id" class="row" data-test="entry">
        <span>{{ e.startedAt.slice(0, 10) }}</span>
        <span class="mono">{{ e.endedAt ? hm(e.durationSec ?? 0) || '0:00' : '…' }}</span>
        <span class="muted grow">{{ e.note }}</span>
        <Menu
          align="end"
          :label="tr('more')"
          :items="[
            {
              id: 'delete',
              label: tr('del'),
              danger: true,
              confirm: { title: tr('confirmDel'), confirmLabel: tr('del') },
              onSelect: () => mutate('time.delete', { id: e.id }),
            },
          ]"
        />
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
ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
