<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { Input, Popover } from '../../ui';
import OptionButton from './OptionButton.vue';

export interface Option {
  id: string;
  label: string;
  /** иконка слева от названия */
  icon?: Component;
  iconProps?: Record<string, unknown>;
}

const props = defineProps<{
  options: Option[];
  selected: string[];
  multiple?: boolean;
  /** подпись кнопки для скринридера и поля поиска */
  title: string;
  compact?: boolean;
  /** текст кнопки, когда ничего не выбрано */
  empty?: string;
}>();
const emit = defineEmits<{ pick: [id: string] }>();
const { t } = useI18n();

const open = ref(false);
// Popover (reka-ui) монтируется при первом наведении/фокусе/нажатии; до этого — лёгкая кнопка с той же разметкой.
// В списке из сотен строк это ~50 мс на вход в проект.
const armed = ref(false);
const btn = ref<{ $el: HTMLElement }>();
/** наведение мыши и фокус с клавиатуры готовят Popover заранее; касание и фокус от клика — нет (клик не должен потеряться) */
const hover = (e: PointerEvent) => e.pointerType === 'mouse' && void arm(e);
const focusIn = (e: FocusEvent) => {
  const el = e.target as HTMLElement;
  if (el.matches(':focus-visible')) void arm(e);
};
async function arm(e: Event) {
  const focused = document.activeElement === btn.value?.$el;
  armed.value = true;
  await nextTick();
  // кнопка заменилась на триггер Popover: фокус возвращаем на неё, клик (мышь, Enter, Space) — открывает
  if (focused) btn.value?.$el.focus();
  if (e.type === 'click') open.value = true;
}
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
  <OptionButton
    v-if="!armed"
    ref="btn"
    v-bind="{ title, chosen, compact, empty }"
    @pointerenter="hover"
    @focus="focusIn"
    @click="arm"
  />
  <Popover v-else v-model:open="open" align="start">
    <template #trigger>
      <OptionButton ref="btn" v-bind="{ title, chosen, compact, empty }" />
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
  </Popover>
</template>
