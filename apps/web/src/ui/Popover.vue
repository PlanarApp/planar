<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';

defineProps<{ side?: 'top' | 'right' | 'bottom' | 'left'; align?: 'start' | 'center' | 'end' }>();
const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child><slot name="trigger" /></PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :side="side"
        :align="align"
        :side-offset="4"
        class="z-50 rounded-lg border border-border bg-surface p-3 text-fg shadow-md outline-none"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
