<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Filter as FilterIcon } from 'lucide-vue-next';
import { Button, Popover } from '../../ui';
import type { Filter } from '../filter';
import type { ViewOptions } from '../options';
import FilterBuilder from './FilterBuilder.vue';
import FilterChips from './FilterChips.vue';
import ViewOptionsPopover from './ViewOptionsPopover.vue';

// noMe — Me Mode задан снаружи («Моя работа»)
defineProps<{ spaceId: string; projectId?: string; noMe?: boolean }>();
const options = defineModel<ViewOptions>('options', { required: true });
const filter = defineModel<Filter | null>('filter', { default: null });
const { t } = useI18n();
import MeMode from './MeMode.vue';
</script>

<template>
  <MeMode v-if="!noMe" v-model="options.me" />
  <Popover align="end">
    <template #trigger>
      <Button variant="ghost" size="sm" compact :icon="FilterIcon" data-testid="filter-toggle">
        {{ t('views.filter.title') }}
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
  <FilterChips v-model="filter" :space-id="spaceId" :project-id="projectId" />
  <ViewOptionsPopover v-model:options="options" />
  <slot />
</template>
