<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { BadgeDollarSign, MessageSquare } from 'lucide-vue-next';
import { Button, Input, Menu } from '@planar/web/modules';
import type { TimeEntry } from '../shared/index.js';
import {
  mutate,
  newId,
  tr,
  useEstimate,
  useMyEntries,
  useNow,
  userId,
  useTaskEntries,
  useTasks,
  useUserNames,
} from './data';
import { clock, dayKey, hm, parseHm, subtreeIds, sumSec } from './lib';

// menu — inside TimeControl: start/stop is next to the time, not here
const props = defineProps<{ taskId: string; menu?: boolean }>();
const now = useNow();
const entries = useMyEntries();
const taskEntries = useTaskEntries(() => props.taskId);
const names = useUserNames();
const tasks = useTasks();
const estimate = useEstimate(() => props.taskId);

const mine = computed(() => entries.value ?? []);
const ids = computed(() => subtreeIds(tasks.value ?? [], props.taskId));
const total = computed(() => sumSec(mine.value, ids.value, userId(), now.value));
const running = computed(() => mine.value.find((e) => !e.endedAt));
const runningHere = computed(() => running.value?.taskId === props.taskId);
// every user's entries on this task (PLNRAPP-145); only own ones are edited
const list = computed(() =>
  [...(taskEntries.value ?? [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
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

const form = ref<HTMLFormElement>();
const focusDur = () => form.value?.querySelector<HTMLInputElement>('[data-test=dur]')?.focus();
onMounted(focusDur);

// the form adds a new entry, or saves the one being edited
const editing = ref<TimeEntry | null>(null);
const day = ref(dayKey(new Date()));
const dur = ref('');
const note = ref('');
const billable = ref(false);
// the note grows with its text (up to max-height)
const noteEl = ref<HTMLTextAreaElement>();
const fit = () => {
  const el = noteEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};
const reset = () => {
  editing.value = null;
  day.value = dayKey(new Date());
  dur.value = note.value = err.value = '';
  billable.value = false;
  void nextTick(fit);
};
const edit = (e: TimeEntry) => {
  editing.value = e;
  day.value = dayKey(new Date(e.startedAt));
  dur.value = hm(e.durationSec ?? 0);
  note.value = e.note ?? '';
  billable.value = !!e.billable; // replica rows from before the column may lack it
  void nextTick(fit);
  focusDur();
};
const del = (e: TimeEntry) => {
  if (editing.value?.id === e.id) reset();
  return mutate('time.delete', { id: e.id });
};
const submit = async () => {
  const sec = parseHm(dur.value);
  if (!sec || sec > 86400 || !day.value) return void (err.value = tr('invalid'));
  err.value = '';
  const [y, m, d] = day.value.split('-').map(Number);
  const e = editing.value;
  // an edited entry keeps its time of day, a new one starts at 9:00
  const at = e ? new Date(e.startedAt) : new Date(y, m - 1, d, 9);
  at.setFullYear(y, m - 1, d);
  const fields = { startedAt: at.toISOString(), durationSec: sec, billable: billable.value };
  if (e) await mutate('time.update', { id: e.id, ...fields, note: note.value || null });
  else
    await mutate('time.log', {
      id: newId(),
      taskId: props.taskId,
      ...fields,
      ...(note.value ? { note: note.value } : {}),
    });
  reset();
};
</script>

<template>
  <section class="tp">
    <div v-if="!menu" class="row">
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
      :title="tr('durHint')"
      data-test="estimate"
      @change="saveEstimate"
    />
    <form ref="form" class="col" @submit.prevent="submit">
      <div class="row">
        <Input
          v-model="dur"
          :label="tr('estimateHint')"
          hide-label
          :placeholder="tr('estimateHint')"
          :title="tr('durHint')"
          class="grow"
          data-test="dur"
        />
        <Input v-model="day" type="date" :label="tr('day')" hide-label data-test="day" />
      </div>
      <textarea
        ref="noteEl"
        v-model="note"
        rows="1"
        maxlength="200"
        :aria-label="tr('note')"
        :placeholder="tr('note')"
        class="note"
        data-test="note"
        @input="fit"
      />
      <div class="row">
        <label class="row check">
          <input v-model="billable" type="checkbox" data-test="billable" />
          {{ tr('billable') }}
        </label>
        <span class="grow" />
        <Button v-if="editing" type="button" data-test="cancel" @click="reset">
          {{ tr('cancel') }}
        </Button>
        <Button type="submit" data-test="add">{{ editing ? tr('save') : tr('add') }}</Button>
      </div>
    </form>
    <p v-if="err" class="err" role="alert">{{ err }}</p>
    <p v-if="!list.length" class="muted">{{ tr('noEntries') }}</p>
    <ul>
      <li
        v-for="e in list"
        :key="e.id"
        :class="['row', 'entry', editing?.id === e.id && 'editing']"
        data-test="entry"
      >
        <span class="who" data-test="entry-user">{{ names?.get(e.userId) ?? '—' }}</span>
        <span>{{ dayKey(new Date(e.startedAt)) }}</span>
        <span class="mono">{{ e.endedAt ? hm(e.durationSec ?? 0) || '0:00' : '…' }}</span>
        <span class="icons">
          <span
            v-if="e.billable"
            role="img"
            :aria-label="tr('billable')"
            :title="tr('billable')"
            data-test="entry-billable"
          >
            <BadgeDollarSign :size="14" aria-hidden="true" />
          </span>
          <span
            v-if="e.note"
            role="img"
            :aria-label="e.note"
            :title="e.note"
            data-test="entry-note"
          >
            <MessageSquare :size="14" aria-hidden="true" />
          </span>
        </span>
        <Menu
          v-if="e.userId === userId()"
          align="end"
          :label="tr('more')"
          :items="[
            ...(e.endedAt ? [{ id: 'edit', label: tr('edit'), onSelect: () => edit(e) }] : []),
            {
              id: 'delete',
              label: tr('del'),
              danger: true,
              confirm: { title: tr('confirmDel'), confirmLabel: tr('del') },
              onSelect: () => del(e),
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
.col {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.grow {
  flex: 1;
}
.note {
  width: 100%;
  min-height: 2rem;
  max-height: 10rem;
  resize: none;
  padding: 4px 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-md, 6px);
  background: var(--color-bg);
  font-size: var(--text-sm);
}
.check {
  gap: 6px;
  font-size: var(--text-sm);
}
.entry {
  flex-wrap: nowrap;
}
.editing {
  background: var(--color-bg-muted);
}
.who {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icons {
  display: inline-flex;
  gap: 4px;
  width: 2.25rem;
  color: var(--color-fg-subtle);
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
