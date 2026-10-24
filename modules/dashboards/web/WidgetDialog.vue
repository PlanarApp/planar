<script setup lang="ts">
import { reactive, watch } from 'vue';
import { Button, Dialog, FilterBuilder, Input, Select } from '@planar/web/modules';
import type { Filter } from '@planar/shared';
import { KINDS, type Widget, type WidgetKind } from '../shared/index.js';
import { tr, useGroupFields, type Key } from './data';

const props = defineProps<{ widget?: Widget; spaceId: string }>();
const emit = defineEmits<{
  save: [v: { kind: WidgetKind; title: string | null; config: Record<string, unknown> }];
}>();
const open = defineModel<boolean>('open', { default: false });

const fields = useGroupFields(() => props.spaceId);
const f = reactive({
  kind: 'number' as WidgetKind,
  title: '',
  filter: { op: 'and', rules: [] } as Filter,
  groupBy: 'status',
  series: 'created',
  weeks: '12',
  sort: 'updatedAt',
  limit: '10',
});
watch(
  () => [open.value, props.widget],
  () => {
    if (!open.value) return;
    const w = props.widget;
    const c = (w?.config ?? {}) as Record<string, unknown>;
    Object.assign(f, {
      kind: w?.kind ?? 'number',
      title: w?.title ?? '',
      filter: (c.filter as Filter) ?? { op: 'and', rules: [] },
      groupBy: (c.groupBy as string) ?? 'status',
      series: (c.series as string) ?? 'created',
      weeks: String(c.weeks ?? 12),
      sort: (c.sort as string) ?? 'updatedAt',
      limit: String(c.limit ?? 10),
    });
  },
  { immediate: true },
);

const opts = (ks: readonly string[]) => ks.map((k) => ({ value: k, label: tr(k as Key) }));
function save() {
  const config: Record<string, unknown> = { filter: f.filter };
  if (f.kind === 'bars') config.groupBy = f.groupBy;
  if (f.kind === 'line') Object.assign(config, { series: f.series, weeks: Number(f.weeks) });
  if (f.kind === 'list') Object.assign(config, { sort: f.sort, limit: Number(f.limit) });
  emit('save', { kind: f.kind, title: f.title.trim() || null, config });
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open" :title="widget ? tr('editWidget') : tr('addWidget')" size="lg">
    <div class="form">
      <Select
        v-if="!widget"
        v-model="f.kind as string"
        :label="tr('kind')"
        :options="opts(KINDS)"
      />
      <Input v-model="f.title" :label="tr('widgetTitle')" />
      <Select
        v-if="f.kind === 'bars'"
        v-model="f.groupBy"
        :label="tr('groupBy')"
        :options="[
          ...opts(['status', 'priority', 'assignee', 'label', 'project']),
          ...(fields ?? []).map((d) => ({ value: `field:${d.id}`, label: d.name })),
        ]"
      />
      <template v-if="f.kind === 'line'">
        <Select
          v-model="f.series"
          :label="tr('series')"
          :options="opts(['created', 'completed'])"
        />
        <Input v-model="f.weeks" type="number" :label="tr('weeks')" />
      </template>
      <template v-if="f.kind === 'list'">
        <Select
          v-model="f.sort"
          :label="tr('sort')"
          :options="opts(['updatedAt', 'dueDate', 'priority'])"
        />
        <Input v-model="f.limit" type="number" :label="tr('limit')" />
      </template>
      <FilterBuilder v-model="f.filter" :space-id="spaceId" />
    </div>
    <template #footer>
      <Button @click="open = false">{{ tr('cancel') }}</Button>
      <Button variant="primary" data-test="save" @click="save">{{ tr('save') }}</Button>
    </template>
  </Dialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
