<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLabels, useMembers, useStatuses } from '../../tasks';
import { useFieldDefs, useSpaceFieldDefs } from '../../fields';
import { Chip } from '../../ui';
import { isFieldRule, type Filter, type FilterRule } from '../filter';

const props = defineProps<{ spaceId: string; projectId?: string }>();
const model = defineModel<Filter | null>({ default: null });
const { t } = useI18n();
const statuses = useStatuses(() => props.spaceId);
const members = useMembers(() => props.spaceId);
const labels = useLabels(() => props.spaceId);
const defsByProject = useFieldDefs(() => props.projectId ?? '');
const defsBySpace = useSpaceFieldDefs(() => props.spaceId);
const defs = computed(() => (props.projectId ? defsByProject : defsBySpace).value ?? []);

// подписи — те же ключи словаря, что у FilterBuilder: поле, оператор, значение
function valueLabel(r: FilterRule, v: unknown): string {
  const s = String(v);
  if (s === 'me') return t('views.filter.me');
  if (s === 'current') return t('views.filter.cycleCurrent');
  const d = isFieldRule(r.field)
    ? defs.value.find((x) => x.id === (r.field as string).slice(6))
    : undefined;
  if (d?.type === 'select')
    return (
      (d.options.choices as { id: string; label: string }[])?.find((c) => c.id === s)?.label ?? s
    );
  if (d?.type === 'user') return members.value?.find((x) => x.id === s)?.name ?? s;
  if (d?.type === 'money' && typeof v === 'number') return String(v / 100);
  if (r.field === 'status') return statuses.value?.find((x) => x.id === s)?.name ?? s;
  if (r.field === 'assignee' || r.field === 'createdBy')
    return members.value?.find((x) => x.id === s)?.name ?? s;
  if (r.field === 'label') return labels.value?.find((x) => x.id === s)?.name ?? s;
  if (r.field === 'priority') return t(`tasks.priority.${s}`);
  if (r.field === 'statusCategory') return t(`views.filter.category.${s}`);
  return s;
}
function label(r: FilterRule): string {
  const f = isFieldRule(r.field)
    ? (defs.value.find((d) => d.id === (r.field as string).slice(6))?.name ?? '—')
    : t(`views.filter.fields.${r.field}`);
  const v = Array.isArray(r.value)
    ? r.value.map((x) => valueLabel(r, x)).join(', ')
    : r.value === undefined
      ? ''
      : valueLabel(r, r.value);
  return [f, t(`views.filter.ops.${r.operator}`), v].filter(Boolean).join(' ');
}
const remove = (i: number) =>
  model.value &&
  (model.value = { ...model.value, rules: model.value.rules.filter((_, j) => j !== i) });
</script>

<template>
  <Chip
    v-for="(r, i) in model?.rules ?? []"
    :key="i"
    removable
    :remove-label="t('views.filter.remove')"
    data-testid="filter-chip"
    @remove="remove(i)"
  >
    {{ label(r) }}
  </Chip>
</template>
