<script setup lang="ts">
import { useBreakpoint } from './useBreakpoint';
import Sheet from './Sheet.vue';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';

defineProps<{ side?: 'top' | 'right' | 'bottom' | 'left'; align?: 'start' | 'center' | 'end' }>();
const { isMobile } = useBreakpoint();
const open = defineModel<boolean>('open', { default: false });
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
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
