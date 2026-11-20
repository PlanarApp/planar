<script setup lang="ts">
import { computed, ref } from 'vue';
import { useHotkey } from '../../command/hotkeys';
import { useI18n } from 'vue-i18n';
import { Filter as FilterIcon, Search } from 'lucide-vue-next';
import { Button, IconButton, Input, Popover } from '../../ui';
import type { Filter } from '../filter';
import type { ViewOptions } from '../options';
import FilterBuilder from './FilterBuilder.vue';
import { useFilterSummary } from './useFilterSummary';
import ViewOptionsPopover from './ViewOptionsPopover.vue';

// noMe — Me Mode is set from outside ("My work")
const props = defineProps<{ spaceId: string; projectId?: string; noMe?: boolean }>();
const options = defineModel<ViewOptions>('options', { required: true });
const filter = defineModel<Filter | null>('filter', { default: null });
const { t } = useI18n();
const active = useFilterSummary(
  () => props.spaceId,
  () => props.projectId,
  () => filter.value,
);
// PLNRAPP-664: an old panel «AI status» the view filter can not take (`legacyAiStatus`) — still filters the view;
// shown in the filter popover, removable
const legacy = computed(() => {
  const s = options.value.aiStatus;
  if (!s) return null;
  const v = s === 'none' ? t('views.aiFilter.none') : t(`tasks.aiState.${s}`);
  return t('views.aiFilter.legacy', { value: v });
});
const tip = computed(() => [...active.value, legacy.value].filter(Boolean).join('\n') || undefined);
// f — quick filter (PLNRAPP-79): a «title or description contains» rule of the view filter, set as you type;
// Delete in the field clears it
// shortcut: with «any rule» (op 'or') the text rule widens the result instead of narrowing; filters can't nest
const quickOpen = ref(false);
const quick = computed({
  get: () => String(filter.value?.rules.find((r) => r.field === 'text')?.value ?? ''),
  set: (v: string) => {
    const rules = (filter.value?.rules ?? []).filter((r) => r.field !== 'text');
    if (v) rules.push({ field: 'text', operator: 'contains', value: v });
    filter.value = rules.length ? { op: filter.value?.op ?? 'and', rules } : null;
  },
});
function onQuickKey(e: KeyboardEvent) {
  if (e.key === 'Enter') quickOpen.value = false;
  else if (e.key === 'Delete') {
    e.preventDefault();
    quick.value = '';
    quickOpen.value = false;
  }
}
useHotkey('f', () => (quickOpen.value = true), { label: 'cmd.hk.filter' });
import MeMode from './MeMode.vue';
</script>

<template>
  <MeMode v-if="!noMe" v-model="options.me" />
  <Popover v-model:open="quickOpen" align="end">
    <template #trigger>
      <IconButton
        size="sm"
        :icon="Search"
        :label="t('views.filter.quick')"
        shortcut="F"
        :active="!!quick"
        data-testid="quick-filter-toggle"
      />
    </template>
    <Input
      v-model="quick"
      class="w-72 max-w-[calc(100vw-2rem)]"
      :label="t('views.filter.quick')"
      :placeholder="t('views.filter.quickHint')"
      hide-label
      autofocus
      data-testid="quick-filter"
      @keydown="onQuickKey"
    />
  </Popover>
  <Popover align="end">
    <template #trigger>
      <Button
        variant="ghost"
        size="sm"
        compact
        :icon="FilterIcon"
        :title="tip"
        data-testid="filter-toggle"
      >
        {{ t('views.filter.title') }}
        <span
          v-if="active.length || legacy"
          class="size-1.5 rounded-full bg-accent"
          data-testid="filter-active"
          :aria-label="t('views.filter.active')"
        />
      </Button>
    </template>
    <div class="max-h-[70vh] w-[36rem] max-w-[calc(100vw-2rem)] overflow-y-auto">
      <div
        v-if="legacy"
        class="mb-2 flex items-start gap-2 rounded-md bg-warning/15 p-2 text-sm text-warning"
        data-testid="ai-legacy"
      >
        <span class="flex-1">{{ legacy }}</span>
        <Button
          size="sm"
          variant="ghost"
          data-testid="ai-legacy-clear"
          @click="options = { ...options, aiStatus: null }"
        >
          {{ t('views.aiFilter.legacyClear') }}
        </Button>
      </div>
      <FilterBuilder
        :model-value="filter ?? { op: 'and', rules: [] }"
        :space-id="spaceId"
        :project-id="projectId"
        with-ai
        @update:model-value="filter = $event"
      />
    </div>
  </Popover>
  <ViewOptionsPopover v-model:options="options"><slot name="layout" /></ViewOptionsPopover>
  <slot />
</template>
