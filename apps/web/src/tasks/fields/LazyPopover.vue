<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';
import { Popover } from '../../ui';

defineProps<{ align?: 'start' | 'center' | 'end' }>();
const open = defineModel<boolean>('open', { default: false });
/**
 * Popover (reka-ui) стоит ~0,5 мс на экземпляр, а в списке их сотни. Пока пользователь не навёл мышь, не сфокусировал
 * с клавиатуры и не нажал, показываем только слот `trigger` (та же разметка); Popover монтируется при первом из этих событий.
 * Касание и фокус от клика заранее не монтируют: смена элемента между нажатием и отпусканием съела бы клик.
 */
const armed = ref(false);
const uid = useId();
const attrs = { 'data-lazy-trigger': uid };

async function arm(e: Event) {
  if (armed.value) return;
  const had = (e.currentTarget as HTMLElement).contains(document.activeElement);
  armed.value = true;
  await nextTick();
  // кнопка заменилась на триггер Popover: возвращаем на неё фокус; нажатие (мышь, Enter, Space) — открывает
  if (had) document.querySelector<HTMLElement>(`[data-lazy-trigger="${uid}"]`)?.focus();
  if (e.type === 'click') open.value = true;
}
const hover = (e: PointerEvent) => e.pointerType === 'mouse' && void arm(e);
const focusIn = (e: FocusEvent) =>
  (e.target as HTMLElement).matches(':focus-visible') && void arm(e);
</script>

<template>
  <span v-if="!armed" class="contents" @pointerover="hover" @focusin="focusIn" @click="arm">
    <slot name="trigger" :attrs="attrs" />
  </span>
  <Popover v-else v-model:open="open" :align="align">
    <template #trigger><slot name="trigger" :attrs="attrs" /></template>
    <slot />
  </Popover>
</template>
