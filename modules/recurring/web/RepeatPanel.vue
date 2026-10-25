<script setup lang="ts">
import { ref, watch } from 'vue';
import { browserTz, mutate, newId, tr, useRule, type Key } from './data';

const props = defineProps<{ taskId: string }>();
const rule = useRule(() => props.taskId);

const kind = ref<'interval' | 'weekdays' | 'after_done'>('interval');
const every = ref(1);
const unit = ref<'day' | 'week' | 'month'>('week');
const days = ref<number[]>([]);
const tz = ref(browserTz());
const error = ref('');

watch(
  rule,
  (r) => {
    if (!r) return;
    kind.value = r.kind;
    every.value = r.every;
    unit.value = r.unit;
    days.value = [...r.weekdays];
    tz.value = r.timezone;
  },
  { immediate: true },
);

const toggle = (d: number) =>
  (days.value = days.value.includes(d)
    ? days.value.filter((x) => x !== d)
    : [...days.value, d].sort((a, b) => a - b));

async function save() {
  error.value = '';
  const wk = kind.value === 'weekdays';
  try {
    await mutate('recurring.set', {
      id: rule.value?.id ?? newId(),
      taskId: props.taskId,
      kind: kind.value,
      every: every.value,
      unit: wk ? 'week' : unit.value,
      weekdays: wk ? days.value : [],
      timezone: tz.value,
    });
  } catch {
    error.value = tr('badTz');
  }
}
const remove = () => mutate('recurring.remove', { taskId: props.taskId });
</script>

<template>
  <section class="flex flex-col gap-2 p-2 text-sm" data-testid="repeat-panel">
    <label class="flex items-center gap-2">
      {{ tr('kind') }}
      <select v-model="kind" data-testid="repeat-kind">
        <option value="interval">{{ tr('interval') }}</option>
        <option value="weekdays">{{ tr('weekdays') }}</option>
        <option value="after_done">{{ tr('after_done') }}</option>
      </select>
    </label>
    <label class="flex items-center gap-2">
      {{ tr('every') }}
      <input v-model.number="every" type="number" min="1" max="365" class="w-16" />
      <select v-if="kind !== 'weekdays'" v-model="unit" :aria-label="tr('every')">
        <option v-for="u in ['day', 'week', 'month'] as const" :key="u" :value="u">
          {{ tr(u) }}
        </option>
      </select>
      <span v-else>{{ tr('week') }}</span>
    </label>
    <div v-if="kind === 'weekdays'" class="flex gap-1" role="group">
      <button
        v-for="d in [1, 2, 3, 4, 5, 6, 0]"
        :key="d"
        type="button"
        :aria-pressed="days.includes(d)"
        :class="days.includes(d) ? 'font-bold underline' : ''"
        @click="toggle(d)"
      >
        {{ tr(`d${d}` as Key) }}
      </button>
    </div>
    <label class="flex items-center gap-2">
      {{ tr('tz') }}
      <input v-model="tz" class="w-48" />
    </label>
    <p v-if="rule?.nextDate" data-testid="repeat-next">{{ tr('next') }}: {{ rule.nextDate }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="flex gap-2">
      <button type="button" data-testid="repeat-save" @click="save">{{ tr('save') }}</button>
      <button v-if="rule" type="button" data-testid="repeat-remove" @click="remove">
        {{ tr('remove') }}
      </button>
    </div>
  </section>
</template>
