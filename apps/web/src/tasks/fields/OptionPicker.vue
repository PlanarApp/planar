<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { Input } from '../../ui';
import LazyPopover from './LazyPopover.vue';

export interface Option {
  id: string;
  label: string;
  /** icon to the left of the name */
  icon?: Component;
  iconProps?: Record<string, unknown>;
}

const props = defineProps<{
  options: Option[];
  selected: string[];
  multiple?: boolean;
  /** button label for screen readers and the search field */
  title: string;
  compact?: boolean;
  /** button text when nothing is selected */
  empty?: string;
}>();
const emit = defineEmits<{ pick: [id: string] }>();
const { t } = useI18n();

const open = ref(false);
const q = ref('');
const active = ref(0);
const shown = computed(() => {
  const s = q.value.trim().toLowerCase();
  return s ? props.options.filter((o) => o.label.toLowerCase().includes(s)) : props.options;
});
const chosen = computed(() => props.options.filter((o) => props.selected.includes(o.id)));
watch([q, open], () => (active.value = 0));
watch(open, (o) => o && (q.value = ''));

function pick(o: Option) {
  emit('pick', o.id);
  if (!props.multiple) open.value = false;
}
function onKey(e: KeyboardEvent) {
  const n = shown.value.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = n ? (active.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n : 0;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (shown.value[active.value]) pick(shown.value[active.value]);
  } else if (e.key === 'Escape') open.value = false;
}
</script>

<template>
  <LazyPopover v-model:open="open" align="start">
    <template #trigger="{ attrs }">
      <button
        v-bind="attrs"
        type="button"
        :aria-label="title"
        class="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-sm text-fg outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
      >
        <!-- value: своё содержимое кнопки (ячейка Списка рисует значение так же, как без пикера) -->
        <slot name="value">
          <component
            :is="o.icon"
            v-for="o in compact ? chosen.slice(0, 1) : chosen"
            :key="o.id"
            v-bind="o.iconProps"
          />
          <span v-if="!compact" class="truncate">{{
            chosen.length ? chosen.map((o) => o.label).join(', ') : (empty ?? '—')
          }}</span>
        </slot>
      </button>
    </template>
    <div class="flex w-56 flex-col gap-2" @keydown="onKey">
      <Input v-model="q" :label="title" hide-label :placeholder="t('tasks.search')" />
      <ul
        role="listbox"
        :aria-label="title"
        :aria-multiselectable="multiple || undefined"
        class="max-h-60 overflow-auto"
      >
        <li
          v-for="(o, i) in shown"
          :key="o.id"
          role="option"
          :aria-selected="selected.includes(o.id)"
          :class="[
            'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm',
            i === active ? 'bg-bg-muted' : '',
          ]"
          @click="pick(o)"
          @mousemove="active = i"
        >
          <component :is="o.icon" v-if="o.icon" v-bind="o.iconProps" />
          <span class="flex-1 truncate">{{ o.label }}</span>
          <span v-if="selected.includes(o.id)" aria-hidden="true">✓</span>
        </li>
        <li v-if="!shown.length" class="px-2 py-1 text-sm text-fg-subtle">
          {{ t('tasks.noResults') }}
        </li>
      </ul>
    </div>
  </LazyPopover>
</template>
