<script setup lang="ts">
import { Calendar } from 'lucide-vue-next';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Input, Popover } from '../../ui';

defineProps<{ compact?: boolean }>();
const model = defineModel<string | null>({ default: null });
const { t } = useI18n();
const open = ref(false);
const set = (v: string) => {
  model.value = v || null;
  open.value = false;
};
</script>

<template>
  <Popover v-model:open="open" align="start">
    <template #trigger>
      <button
        type="button"
        :aria-label="t('tasks.dueDate')"
        class="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm text-fg outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
      >
        <Calendar :size="14" aria-hidden="true" />
        <span v-if="!compact">{{ model ?? t('tasks.noDate') }}</span>
      </button>
    </template>
    <div class="flex w-56 flex-col gap-2">
      <Input
        :model-value="model ?? ''"
        type="date"
        :label="t('tasks.dueDate')"
        hide-label
        @update:model-value="set"
      />
      <Button v-if="model" size="sm" variant="ghost" @click="set('')">{{
        t('tasks.clear')
      }}</Button>
    </div>
  </Popover>
</template>
