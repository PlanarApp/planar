<script setup lang="ts">
import { Calendar } from 'lucide-vue-next';
import { defineAsyncComponent, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Input } from '../../ui';
import { formatDue } from '../../views/list/due';
import LazyPopover from './LazyPopover.vue';

// label/empty — for the start date (default: due date); taskId — a task's due date: «My day» choices on top (PLNRAPP-137)
const props = defineProps<{ compact?: boolean; label?: string; empty?: string; taskId?: string }>();
// async: inbox imports tasks
const DayOptions = defineAsyncComponent(() => import('../../inbox/DayOptions.vue'));
const model = defineModel<string | null>({ default: null });
const { t, locale } = useI18n();
const open = ref(false);
const set = (v: string) => {
  model.value = v || null;
  open.value = false;
};
</script>

<template>
  <LazyPopover v-model:open="open" align="start">
    <template #trigger="{ attrs }">
      <button
        v-bind="attrs"
        type="button"
        :aria-label="props.label ?? t('tasks.dueDate')"
        class="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm text-fg outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
      >
        <slot name="value">
          <Calendar :size="14" aria-hidden="true" />
          <span v-if="!compact">{{
            model ? formatDue(model, locale) : (props.empty ?? t('tasks.noDate'))
          }}</span>
        </slot>
      </button>
    </template>
    <div class="flex w-56 flex-col gap-2">
      <!-- extra choices above the date (My day: today, tomorrow, remove) -->
      <slot name="options" :close="() => (open = false)">
        <DayOptions v-if="taskId" :task-id="taskId" @done="open = false" />
      </slot>
      <Input
        :model-value="model ?? ''"
        type="date"
        :label="props.label ?? t('tasks.dueDate')"
        hide-label
        @update:model-value="set"
      />
      <Button v-if="model" size="sm" variant="ghost" @click="set('')">{{
        t('tasks.clear')
      }}</Button>
    </div>
  </LazyPopover>
</template>
