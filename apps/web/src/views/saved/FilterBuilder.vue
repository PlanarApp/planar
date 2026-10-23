<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, X } from 'lucide-vue-next';
import { AssigneePicker, DueDatePicker, LabelPicker, useProject, useStatuses } from '../../tasks';
import { useFieldDefs, useSpaceFieldDefs } from '../../fields';
import { Button, Input } from '../../ui';
import { useExtensions } from '../../modules/registry';
import {
  FIELD_OPERATORS,
  isFieldRule,
  operatorsFor,
  type Filter,
  type FilterField,
  type FilterRule,
} from '../filter';

const props = defineProps<{ spaceId?: string; projectId?: string }>();
const model = defineModel<Filter>({ required: true });
const { t } = useI18n();
// SDK модулей передаёт только projectId: пространство берём из проекта
const project = useProject(() => props.projectId ?? '');
const spaceId = computed(() => props.spaceId ?? project.value?.spaceId ?? '');
const statuses = useStatuses(spaceId);

// поля проекта (или всех проектов пространства, если проект не задан)
const defsByProject = useFieldDefs(() => props.projectId ?? '');
const defsBySpace = useSpaceFieldDefs(spaceId);
const defs = computed(() => (props.projectId ? defsByProject : defsBySpace).value ?? []);
// правило «Спринт» — только при включённом модуле sprints
const modViews = useExtensions('views');
const hasSprints = computed(() => modViews.value.some((v) => v.moduleId === 'sprints'));
const fields = computed<FilterField[]>(() => [
  ...(Object.keys(FIELD_OPERATORS) as FilterField[]).filter(
    (f) => f !== 'cycle' || hasSprints.value,
  ),
  ...defs.value.map((d) => `field:${d.id}` as const),
]);
const fieldLabel = (f: FilterField) =>
  isFieldRule(f)
    ? (defs.value.find((d) => d.id === f.slice(6))?.name ?? '—')
    : t(`views.filter.fields.${f}`);
const ops = (f: FilterField) => operatorsFor(f, defs.value);
/** Вид ввода значения: базовое поле или тип пользовательского. */
function kind(r: FilterRule): string {
  if (!isFieldRule(r.field)) return r.field;
  const d = defs.value.find((x) => x.id === (r.field as string).slice(6));
  return d
    ? (
        {
          select: 'fselect',
          user: 'assignee',
          date: 'dueDate',
          number: 'num',
          money: 'num',
          text: 'title',
          url: 'title',
        } as const
      )[d.type]
    : 'title';
}
const defOf = (r: FilterRule) => defs.value.find((x) => x.id === (r.field as string).slice(6));
const choices = (r: FilterRule) =>
  ((defOf(r)?.options.choices as { id: string; label: string }[]) ?? []).map((c) => ({
    v: c.id,
    l: c.label,
  }));
const isMoney = (r: FilterRule) => defOf(r)?.type === 'money';
const showNum = (r: FilterRule) =>
  typeof r.value === 'number' ? String(isMoney(r) ? r.value / 100 : r.value) : '';
function setNum(i: number, r: FilterRule, v: string) {
  const x = Number(v.replace(',', '.'));
  patch(i, {
    value: v.trim() && Number.isFinite(x) ? (isMoney(r) ? Math.round(x * 100) : x) : undefined,
  });
}
const CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'];
const selectClass =
  'h-11 md:h-8 rounded-md border border-border-strong bg-bg px-2 text-base text-fg outline-none focus-visible:ring-2 ring-focus';

const rules = computed(() => model.value.rules);
const setRules = (r: FilterRule[]) => (model.value = { ...model.value, rules: r });
const patch = (i: number, p: Partial<FilterRule>) =>
  setRules(rules.value.map((r, j) => (j === i ? { ...r, ...p } : r)));

function setField(i: number, field: FilterField) {
  setRules(rules.value.map((r, j) => (j === i ? { field, operator: ops(field)[0] } : r)));
}
// смена оператора сбрасывает значение
const setOperator = (i: number, operator: FilterRule['operator']) =>
  setRules(rules.value.map((r, j) => (j === i ? { field: r.field, operator } : r)));
const add = () =>
  setRules([...rules.value, { field: 'status', operator: FIELD_OPERATORS.status[0] }]);
const remove = (i: number) => setRules(rules.value.filter((_, j) => j !== i));

const list = (r: FilterRule): string[] => (Array.isArray(r.value) ? r.value.map(String) : []);
const hasValue = (r: FilterRule) => r.operator !== 'isEmpty' && r.operator !== 'isNotEmpty';
function toggle(i: number, r: FilterRule, v: string) {
  const cur = list(r);
  const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  patch(i, { value: r.field === 'priority' ? next.map(Number) : next });
}
/** assignee/createdBy: пикер без 'me' + отдельный переключатель «Я». */
const people = (r: FilterRule) => list(r).filter((x) => x !== 'me');
const setPeople = (i: number, r: FilterRule, ids: string[]) =>
  patch(i, { value: [...(list(r).includes('me') ? ['me'] : []), ...ids] });
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="filter-builder">
    <div class="flex items-center gap-2">
      <span class="text-sm text-fg-muted">{{ t('views.filter.match') }}</span>
      <div role="group" class="inline-flex gap-1" :aria-label="t('views.filter.match')">
        <Button
          v-for="op in ['and', 'or'] as const"
          :key="op"
          size="sm"
          :variant="model.op === op ? 'primary' : 'secondary'"
          :aria-pressed="model.op === op"
          :data-op="op"
          @click="model = { ...model, op }"
        >
          {{ t(`views.filter.${op}`) }}
        </Button>
      </div>
    </div>

    <div
      v-for="(r, i) in rules"
      :key="i"
      class="flex flex-wrap items-center gap-2"
      data-testid="filter-rule"
    >
      <select
        :class="selectClass"
        :aria-label="t('views.filter.field')"
        data-role="field"
        :value="r.field"
        @change="setField(i, ($event.target as HTMLSelectElement).value as FilterField)"
      >
        <option v-for="f in fields" :key="f" :value="f">{{ fieldLabel(f) }}</option>
      </select>
      <select
        :class="selectClass"
        :aria-label="t('views.filter.operator')"
        data-role="operator"
        :value="r.operator"
        @change="
          setOperator(i, ($event.target as HTMLSelectElement).value as FilterRule['operator'])
        "
      >
        <option v-for="o in ops(r.field)" :key="o" :value="o">
          {{ t(`views.filter.ops.${o}`) }}
        </option>
      </select>

      <template v-if="hasValue(r)">
        <div
          v-if="['status', 'statusCategory', 'priority', 'fselect'].includes(kind(r))"
          class="flex flex-wrap gap-x-3 gap-y-1"
          role="group"
          :aria-label="t('views.filter.value')"
        >
          <label
            v-for="o in kind(r) === 'fselect'
              ? choices(r)
              : r.field === 'status'
                ? (statuses ?? []).map((s) => ({ v: s.id, l: s.name }))
                : r.field === 'priority'
                  ? [0, 1, 2, 3, 4].map((p) => ({ v: String(p), l: t(`tasks.priority.${p}`) }))
                  : CATEGORIES.map((c) => ({ v: c, l: t(`views.filter.category.${c}`) }))"
            :key="o.v"
            class="inline-flex items-center gap-1.5 text-sm"
          >
            <input
              type="checkbox"
              :checked="list(r).includes(o.v)"
              :data-value="o.v"
              @change="toggle(i, r, o.v)"
            />
            {{ o.l }}
          </label>
        </div>
        <template v-else-if="kind(r) === 'assignee' || kind(r) === 'createdBy'">
          <label class="inline-flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              :checked="list(r).includes('me')"
              data-value="me"
              @change="toggle(i, r, 'me')"
            />
            {{ t('views.filter.me') }}
          </label>
          <AssigneePicker
            :space-id="spaceId"
            :model-value="people(r)"
            @update:model-value="setPeople(i, r, $event)"
          />
        </template>
        <label v-else-if="kind(r) === 'cycle'" class="inline-flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            :checked="list(r).includes('current')"
            data-value="current"
            @change="toggle(i, r, 'current')"
          />
          {{ t('views.filter.cycleCurrent') }}
        </label>
        <LabelPicker
          v-else-if="kind(r) === 'label'"
          :space-id="spaceId"
          :model-value="list(r)"
          @update:model-value="patch(i, { value: $event })"
        />
        <template v-else-if="kind(r) === 'dueDate'">
          <Input
            :model-value="typeof r.value === 'string' ? r.value : ''"
            :label="t('views.filter.value')"
            hide-label
            :placeholder="t('views.filter.date')"
            @update:model-value="patch(i, { value: $event })"
          />
          <DueDatePicker
            compact
            :model-value="null"
            @update:model-value="$event && patch(i, { value: $event })"
          />
        </template>
        <Input
          v-else-if="kind(r) === 'num'"
          :model-value="showNum(r)"
          :label="t('views.filter.value')"
          hide-label
          @update:model-value="setNum(i, r, $event)"
        />
        <Input
          v-else
          :model-value="typeof r.value === 'string' ? r.value : ''"
          :label="t('views.filter.value')"
          hide-label
          @update:model-value="patch(i, { value: $event })"
        />
      </template>

      <Button
        variant="ghost"
        size="sm"
        :icon="X"
        :aria-label="t('views.filter.remove')"
        data-role="remove"
        @click="remove(i)"
      />
    </div>

    <div>
      <Button size="sm" :icon="Plus" data-role="add" @click="add">{{
        t('views.filter.add')
      }}</Button>
    </div>
  </div>
</template>
