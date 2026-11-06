<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Filter as FilterIcon } from 'lucide-vue-next';
import { Button, Popover } from '../../ui';
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
const tip = computed(() => active.value.join('\n') || undefined);
import MeMode from './MeMode.vue';
</script>

<template>
  <MeMode v-if="!noMe" v-model="options.me" />
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
          v-if="active.length"
          class="size-1.5 rounded-full bg-accent"
          data-testid="filter-active"
          :aria-label="t('views.filter.active')"
        />
      </Button>
    </template>
    <div class="max-h-[70vh] w-[36rem] max-w-[calc(100vw-2rem)] overflow-y-auto">
      <FilterBuilder
        :model-value="filter ?? { op: 'and', rules: [] }"
        :space-id="spaceId"
        :project-id="projectId"
        @update:model-value="filter = $event"
      />
    </div>
  </Popover>
  <ViewOptionsPopover v-model:options="options"><slot name="layout" /></ViewOptionsPopover>
  <slot />
</template>
