<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowDownUp, ListTree, SlidersHorizontal } from 'lucide-vue-next';
import { Button, Popover, Select } from '../../ui';
import { TASK_FIELDS, type TaskField, type ViewOptions } from '../options';

const options = defineModel<ViewOptions>('options', { required: true });
const { t } = useI18n();

const groups = ['status', 'assignee', 'priority', 'label', 'none'] as const;
const sorts = ['rank', 'priority', 'dueDate', 'createdAt', 'updatedAt', 'title'] as const;
const groupOptions = computed(() =>
  groups.map((v) => ({ value: v, label: t(`views.group.${v}`) })),
);
const sortOptions = computed(() => sorts.map((v) => ({ value: v, label: t(`views.sort.${v}`) })));
const toggleField = (f: TaskField) =>
  (options.value.fields = options.value.fields.includes(f)
    ? options.value.fields.filter((x) => x !== f)
    : TASK_FIELDS.filter((x) => x === f || options.value.fields.includes(x)));
</script>

<template>
  <Popover align="end">
    <template #trigger>
      <Button variant="ghost" size="sm" :icon="SlidersHorizontal" data-testid="view-toggle">
        {{ t('views.view') }}
      </Button>
    </template>
    <div class="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3" data-testid="view-options">
      <Select v-model="options.groupBy" :label="t('views.groupBy')" :options="groupOptions" />
      <div class="flex items-end gap-2">
        <Select v-model="options.sortBy" :label="t('views.sortBy')" :options="sortOptions" />
        <Button
          :icon="ArrowDownUp"
          :aria-label="t('views.sortDir')"
          :aria-pressed="options.sortDir === 'desc'"
          @click="options.sortDir = options.sortDir === 'asc' ? 'desc' : 'asc'"
        />
      </div>
      <Button
        :icon="ListTree"
        :variant="options.showSubtasks ? 'primary' : 'secondary'"
        :aria-pressed="options.showSubtasks"
        @click="options.showSubtasks = !options.showSubtasks"
      >
        {{ t('views.subtasks') }}
      </Button>
      <label class="inline-flex items-center gap-1.5 text-sm">
        <input v-model="options.showEmpty" type="checkbox" data-testid="show-empty" />
        {{ t('views.showEmpty') }}
      </label>
      <div role="group" :aria-label="t('views.fields.title')" class="flex flex-col gap-1">
        <span class="text-xs text-fg-muted">{{ t('views.fields.title') }}</span>
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
  </Popover>
</template>
