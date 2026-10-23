<script setup lang="ts">
import { computed } from 'vue';
import { FIELD_OPERATORS, type BaseField, type Filter, type FilterOperator } from '@planar/shared';
import { Button } from '@planar/web/modules';
import { text } from './data';

// Упрощённый конструктор отбора (F-filter): ядро не отдаёт модулям свой FilterBuilder.
const model = defineModel<Filter>({ required: true });
const tx = computed(text);
const FIELDS = Object.keys(FIELD_OPERATORS) as BaseField[];
const NO_VALUE: FilterOperator[] = ['isEmpty', 'isNotEmpty'];
const NUMERIC: FilterOperator[] = ['gte', 'lte'];

const set = (f: Filter) => (model.value = f);
const patch = (i: number, p: Partial<Filter['rules'][number]>) =>
  set({ ...model.value, rules: model.value.rules.map((r, j) => (j === i ? { ...r, ...p } : r)) });
const add = () =>
  set({
    ...model.value,
    rules: [...model.value.rules, { field: 'priority', operator: 'in', value: [] }],
  });
const remove = (i: number) =>
  set({ ...model.value, rules: model.value.rules.filter((_, j) => j !== i) });
const changeField = (i: number, field: BaseField) =>
  patch(i, { field, operator: FIELD_OPERATORS[field][0]!, value: [] });
const shown = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));
const parse = (op: FilterOperator, s: string) =>
  NO_VALUE.includes(op)
    ? undefined
    : NUMERIC.includes(op)
      ? Number(s)
      : ['in', 'notIn'].includes(op)
        ? s
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        : s;
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="conditions">
    <select
      v-if="model.rules.length > 1"
      :value="model.op"
      class="h-11 w-24 rounded-md border border-border-strong bg-bg px-2 text-base md:h-8"
      data-role="op"
      @change="set({ ...model, op: ($event.target as HTMLSelectElement).value as 'and' | 'or' })"
    >
      <option value="and">AND</option>
      <option value="or">OR</option>
    </select>
    <div v-for="(r, i) in model.rules" :key="i" class="flex flex-wrap items-center gap-2">
      <select
        :value="r.field"
        class="h-11 rounded-md border border-border-strong bg-bg px-2 text-base md:h-8"
        data-role="field"
        @change="changeField(i, ($event.target as HTMLSelectElement).value as BaseField)"
      >
        <option v-for="f in FIELDS" :key="f" :value="f">{{ f }}</option>
      </select>
      <select
        :value="r.operator"
        class="h-11 rounded-md border border-border-strong bg-bg px-2 text-base md:h-8"
        data-role="operator"
        @change="
          patch(i, {
            operator: ($event.target as HTMLSelectElement).value as FilterOperator,
            value: [],
          })
        "
      >
        <option v-for="o in FIELD_OPERATORS[r.field as BaseField] ?? []" :key="o" :value="o">
          {{ tx.op[o] }}
        </option>
      </select>
      <input
        v-if="!NO_VALUE.includes(r.operator)"
        :value="shown(r.value)"
        :aria-label="tx.value"
        class="h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-bg px-2 text-base md:h-8"
        data-role="value"
        @input="patch(i, { value: parse(r.operator, ($event.target as HTMLInputElement).value) })"
      />
      <Button size="sm" variant="ghost" :aria-label="tx.delete" @click="remove(i)">×</Button>
    </div>
    <div>
      <Button size="sm" data-role="add-condition" @click="add">{{ tx.addCondition }}</Button>
    </div>
  </div>
</template>
