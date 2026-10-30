<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, FolderKanban } from 'lucide-vue-next';
import { Button, Popover } from '../ui';

// фильтр сводки по проектам: пусто — «Все проекты», можно выбрать несколько и очистить
const props = defineProps<{ options: { value: string; label: string }[] }>();
const picked = defineModel<string[]>({ default: () => [] });
const { t } = useI18n();
const label = computed(() =>
  !picked.value.length
    ? t('views.projects.all')
    : picked.value.length === 1
      ? (props.options.find((o) => o.value === picked.value[0])?.label ?? '?')
      : t('views.projects.n', { n: picked.value.length }),
);
const toggle = (id: string) =>
  (picked.value = picked.value.includes(id)
    ? picked.value.filter((x) => x !== id)
    : [...picked.value, id]);
</script>

<template>
  <Popover align="end">
    <template #trigger>
      <Button
        variant="ghost"
        size="sm"
        :icon="FolderKanban"
        compact
        data-testid="project-filter"
        :aria-pressed="picked.length > 0"
        :class="picked.length && 'bg-accent-subtle text-fg'"
        :title="t('views.projects.hint')"
      >
        {{ label }}<ChevronDown :size="12" class="text-fg-subtle" />
      </Button>
    </template>
    <div
      class="flex max-h-80 w-64 flex-col gap-1 overflow-y-auto"
      role="group"
      :aria-label="t('views.projects.title')"
    >
      <button
        type="button"
        class="flex h-8 items-center rounded-md px-2 text-left text-sm hover:bg-bg-muted"
        :class="!picked.length && 'font-medium'"
        data-testid="project-filter-all"
        @click="picked = []"
      >
        {{ t('views.projects.all') }}
      </button>
      <label
        v-for="o in options"
        :key="o.value"
        class="flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-bg-muted"
      >
        <input type="checkbox" :checked="picked.includes(o.value)" @change="toggle(o.value)" />
        <span class="truncate">{{ o.label }}</span>
      </label>
    </div>
  </Popover>
</template>
