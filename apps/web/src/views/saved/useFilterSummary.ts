import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useLabels, useMembers, useStatuses } from '../../tasks';
import { useFieldDefs, useSpaceFieldDefs } from '../../fields';
import { isFieldRule, type Filter, type FilterRule } from '../filter';

/** readable list of active filter rules, for the filter button tooltip */
export function useFilterSummary(
  spaceId: () => string,
  projectId: () => string | undefined,
  filter: () => Filter | null | undefined,
) {
  const { t } = useI18n();

  const statuses = useStatuses(spaceId);
  const members = useMembers(spaceId);
  const labels = useLabels(spaceId);
  const defsByProject = useFieldDefs(() => projectId() ?? '');
  const defsBySpace = useSpaceFieldDefs(spaceId);
  const defs = computed(() => (projectId() ? defsByProject : defsBySpace).value ?? []);

  // labels — the same dictionary keys as FilterBuilder: field, operator, value
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
      ? [...new Set(r.value.map((x) => valueLabel(r, x)))].join(', ')
      : r.value === undefined
        ? ''
        : valueLabel(r, r.value);
    return [f, t(`views.filter.ops.${r.operator}`), v].filter(Boolean).join(' ');
  }
  return computed(() => (filter()?.rules ?? []).map(label));
}
