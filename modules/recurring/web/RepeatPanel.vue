<script setup lang="ts">
import { ref, watch } from 'vue';
import { Button, Input, Select, useSession } from '@planar/web/modules';
import { browserTz, mutate, newId, tr, useRule, type Key } from './data';

const props = defineProps<{ taskId: string }>();
const rule = useRule(() => props.taskId);

const kinds = ['interval', 'weekdays', 'after_done'] as const;
const units = ['day', 'week', 'month'] as const;
const kind = ref<'interval' | 'weekdays' | 'after_done'>('interval');
const every = ref(1);
const unit = ref<'day' | 'week' | 'month'>('week');
const days = ref<number[]>([]);
const anchor = ref('');
const session = useSession();
const error = ref('');

watch(
  rule,
  (r) => {
    if (!r) return;
    kind.value = r.kind;
    every.value = r.every;
    unit.value = r.unit;
    days.value = [...r.weekdays];
    anchor.value = r.anchorDate;
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
      timezone: session.value?.timezone || browserTz(),
      ...(kind.value === 'interval' && anchor.value && { anchorDate: anchor.value }),
    });
  } catch {
    error.value = tr('badTz');
  }
}
const remove = () => mutate('recurring.remove', { taskId: props.taskId });
</script>

<template>
  <section class="flex flex-col gap-3 p-2 text-sm" data-testid="repeat-panel">
    <Select
      v-model="kind"
      :label="tr('kind')"
      :options="kinds.map((k) => ({ value: k, label: tr(k) }))"
      data-testid="repeat-kind"
    />
    <div class="flex items-end gap-2">
      <Input
        :model-value="String(every)"
        @update:model-value="(v: string) => (every = Number(v))"
        type="number"
        min="1"
        max="365"
        :label="tr('every')"
        class="w-24"
      />
      <Select
        v-if="kind !== 'weekdays'"
        v-model="unit"
        :label="tr('every')"
        :options="units.map((u) => ({ value: u, label: tr(u) }))"
      />
      <span v-else class="pb-1.5">{{ tr('week') }}</span>
    </div>
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
    <Input
      v-if="kind === 'interval'"
      v-model="anchor"
      type="date"
      :label="tr('anchor')"
      data-testid="repeat-anchor"
    />
    <p v-if="rule?.nextDate" data-testid="repeat-next">{{ tr('next') }}: {{ rule.nextDate }}</p>
    <p v-if="error" role="alert" class="text-danger">{{ error }}</p>
    <div class="flex gap-2">
      <Button variant="primary" data-testid="repeat-save" @click="save">{{ tr('save') }}</Button>
      <Button v-if="rule" variant="danger-ghost" data-testid="repeat-remove" @click="remove">
        {{ tr('remove') }}
      </Button>
    </div>
  </section>
</template>
