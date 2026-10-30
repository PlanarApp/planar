<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';
import { Popover } from '../../ui';

defineProps<{ align?: 'start' | 'center' | 'end' }>();
const open = defineModel<boolean>('open', { default: false });
/**
 * Popover (reka-ui) costs ~0.5 ms per instance, and a list has hundreds of them. Until the user hovers with the mouse, focuses
 * with the keyboard or presses, we show only the `trigger` slot (same markup); Popover is mounted on the first of these events.
 * A touch and focus from a click do not mount it in advance: swapping the element between press and release would eat the click.
 */
const armed = ref(false);
const uid = useId();
const attrs = { 'data-lazy-trigger': uid };

async function arm(e: Event) {
  if (armed.value) return;
  const had = (e.currentTarget as HTMLElement).contains(document.activeElement);
  armed.value = true;
  await nextTick();
  // the button was replaced by the Popover trigger: we return focus to it; a press (mouse, Enter, Space) — opens
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
