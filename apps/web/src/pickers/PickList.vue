<script setup lang="ts">
import { nextTick, onMounted, ref, watch, type Component } from 'vue';

/**
 * Search field + result list of the task and document pickers (PLNRAPP-827): arrows move, Enter and a
 * click pick; the press does not take the focus from the field. Other keys go out as `key`.
 */
export interface PickRow {
  id: string;
  title: string;
  /** small text before the title (task key) */
  prefix?: string;
  /** parents, outermost first, " / "-joined — a line above the title */
  path?: string;
  /** icon of the row (status) instead of the picker's own one */
  icon?: Component;
  iconProps?: Record<string, unknown>;
}
const props = defineProps<{
  rows: readonly PickRow[];
  label: string;
  placeholder?: string;
  /** text of an empty list: with a query and without one */
  none: string;
  hint?: string;
  icon?: Component;
  autofocus?: boolean;
  inputTestid?: string;
  optionTestid?: string;
}>();
const emit = defineEmits<{ pick: [id: string]; key: [e: KeyboardEvent] }>();
const q = defineModel<string>('query', { default: '' });
const index = ref(0);
const input = ref<HTMLInputElement | null>(null);
watch(
  () => props.rows,
  () => (index.value = 0),
);
function onKey(e: KeyboardEvent) {
  const n = props.rows.length;
  if (e.key === 'ArrowDown' && n) index.value = (index.value + 1) % n;
  else if (e.key === 'ArrowUp' && n) index.value = (index.value + n - 1) % n;
  else if (e.key === 'Enter' && props.rows[index.value]) emit('pick', props.rows[index.value]!.id);
  else return emit('key', e);
  e.preventDefault();
  e.stopPropagation();
}
onMounted(() => props.autofocus && nextTick(() => input.value?.focus()));
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <input
      ref="input"
      v-model="q"
      type="search"
      :placeholder="placeholder ?? label"
      :aria-label="label"
      :data-testid="inputTestid"
      class="h-11 rounded-md border border-border-strong bg-bg px-2 text-sm outline-none focus-visible:ring-2 ring-focus md:h-8"
      @keydown="onKey"
    />
    <ul role="listbox" :aria-label="label" class="max-h-64 overflow-y-auto">
      <li
        v-for="(r, i) in rows"
        :key="r.id"
        role="option"
        :aria-selected="i === index"
        :data-testid="optionTestid"
        :class="[
          'flex min-h-11 cursor-default items-start gap-2 rounded-md px-2 py-1 text-sm md:min-h-8',
          i === index && 'bg-bg-muted',
        ]"
        @mousedown.prevent
        @mousemove="index = i"
        @click="emit('pick', r.id)"
      >
        <component :is="r.icon" v-if="r.icon" v-bind="r.iconProps" class="mt-0.5 shrink-0" />
        <component :is="icon" v-else-if="icon" :size="14" class="mt-0.5 shrink-0 text-fg-subtle" />
        <span class="min-w-0 flex-1 break-words">
          <span v-if="r.path" class="block text-xs text-fg-subtle" data-testid="pick-path">{{
            r.path
          }}</span>
          <span v-if="r.prefix" class="mr-1 text-xs text-fg-subtle">{{ r.prefix }}</span>
          {{ r.title }}
        </span>
      </li>
      <li v-if="!rows.length && (q.trim() || hint)" class="px-2 py-1 text-xs text-fg-subtle">
        {{ q.trim() ? none : hint }}
      </li>
    </ul>
  </div>
</template>
