<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowDownUp, Columns3, Filter as FilterIcon, ListTree } from 'lucide-vue-next';
import { Button, Select } from '../../ui';
import type { Filter } from '../filter';
import { TASK_FIELDS, type TaskField, type ViewOptions } from '../options';
import FilterBuilder from './FilterBuilder.vue';

defineProps<{ spaceId: string }>();
const options = defineModel<ViewOptions>('options', { required: true });
const filter = defineModel<Filter | null>('filter', { default: null });
const { t } = useI18n();

const groups = ['status', 'assignee', 'priority', 'label'] as const;
const sorts = ['rank', 'priority', 'dueDate', 'createdAt', 'updatedAt', 'title'] as const;
const groupOptions = computed(() =>
  groups.map((v) => ({ value: v, label: t(`views.group.${v}`) })),
);
const sortOptions = computed(() => sorts.map((v) => ({ value: v, label: t(`views.sort.${v}`) })));

const panel = ref<'filter' | 'fields' | null>(null);
const toggle = (p: 'filter' | 'fields') => (panel.value = panel.value === p ? null : p);
const count = computed(() => filter.value?.rules.length ?? 0);
const toggleField = (f: TaskField) =>
  (options.value.fields = options.value.fields.includes(f)
    ? options.value.fields.filter((x) => x !== f)
    : TASK_FIELDS.filter((x) => x === f || options.value.fields.includes(x)));
</script>

<template>
  <div class="px-4 py-2" data-testid="view-options">
    <div class="flex flex-wrap items-center gap-2">
      <Select v-model="options.groupBy" :label="t('views.groupBy')" :options="groupOptions" />
      <Select v-model="options.sortBy" :label="t('views.sortBy')" :options="sortOptions" />
      <Button
        :icon="ArrowDownUp"
        :aria-label="t('views.sortDir')"
        :aria-pressed="options.sortDir === 'desc'"
        @click="options.sortDir = options.sortDir === 'asc' ? 'desc' : 'asc'"
      />
      <Button
        :icon="ListTree"
        :variant="options.showSubtasks ? 'primary' : 'secondary'"
        :aria-pressed="options.showSubtasks"
        @click="options.showSubtasks = !options.showSubtasks"
      >
        {{ t('views.subtasks') }}
      </Button>
      <Button
        :icon="FilterIcon"
        :variant="count ? 'primary' : 'secondary'"
        :aria-expanded="panel === 'filter'"
        data-testid="filter-toggle"
        @click="toggle('filter')"
      >
        {{ t('views.filter.title') }}{{ count ? ` · ${count}` : '' }}
      </Button>
      <Button
        :icon="Columns3"
        :aria-expanded="panel === 'fields'"
        data-testid="fields-toggle"
        @click="toggle('fields')"
      >
        {{ t('views.fields.title') }}
      </Button>
      <slot />
    </div>
    <div v-if="panel === 'filter'" class="pt-2">
      <FilterBuilder
        :model-value="filter ?? { op: 'and', rules: [] }"
        :space-id="spaceId"
        @update:model-value="filter = $event"
      />
    </div>
    <div
      v-else-if="panel === 'fields'"
      class="flex flex-wrap gap-x-4 gap-y-1 pt-2"
      role="group"
      :aria-label="t('views.fields.title')"
    >
      <label v-for="f in TASK_FIELDS" :key="f" class="inline-flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          :checked="options.fields.includes(f)"
          :data-field="f"
          @change="toggleField(f)"
        />
        {{ t(`views.fields.${f}`) }}
      </label>
    </div>
  </div>
</template>
