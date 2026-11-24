<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { useBreakpoint } from './useBreakpoint';
import Sheet from './Sheet.vue';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { insideBox } from './popoverOutside';

defineProps<{ side?: 'top' | 'right' | 'bottom' | 'left'; align?: 'start' | 'center' | 'end' }>();
const { isMobile } = useBreakpoint();
const open = defineModel<boolean>('open', { default: false });

// PLNRAPP-820: an open Select inside (the «View» form) turns pointer events of the page off, the popover
// included — a second click on the select or a click on a form field lands on the page under it, and reka
// takes that press (or the focus it moves) for an outside one: the whole form closed. Only the dropdown
// has to close: a press within the popover box is not «outside», nor the focus it moved.
const inner = ref<HTMLElement | null>(null); // the slot wrapper; its parent — the content element
let pressedInsideAt = 0;
const onPress = (e: PointerEvent) => {
  const box = inner.value?.parentElement;
  pressedInsideAt = box && insideBox(e, box) ? e.timeStamp : 0;
};
watchEffect((cleanup) => {
  if (!open.value || isMobile.value) return;
  document.addEventListener('pointerdown', onPress, true);
  cleanup(() => document.removeEventListener('pointerdown', onPress, true));
});
const keepOpen = (e: Event) => {
  const orig = (e as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
  if (!orig) return;
  const box = inner.value?.parentElement;
  if (
    orig.type === 'pointerdown'
      ? box && insideBox(orig as PointerEvent, box)
      : pressedInsideAt > 0 && orig.timeStamp - pressedInsideAt < 1000
  )
    e.preventDefault();
};
</script>

<template>
  <Sheet v-if="isMobile" v-model:open="open">
    <template #trigger><slot name="trigger" /></template>
    <div class="p-3"><slot /></div>
  </Sheet>
  <PopoverRoot v-else v-model:open="open">
    <PopoverTrigger as-child><slot name="trigger" /></PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :side="side"
        :align="align"
        :side-offset="4"
        class="z-50 rounded-lg border border-border bg-surface p-3 text-fg shadow-popover outline-none"
        @interact-outside="keepOpen"
      >
        <div ref="inner" class="contents"><slot /></div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
