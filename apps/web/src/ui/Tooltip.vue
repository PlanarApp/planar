<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui';
import { useBreakpoint } from './useBreakpoint';
import Kbd from './Kbd.vue';

defineProps<{ content: string; shortcut?: string }>();
const { isMobile } = useBreakpoint();
</script>

<template>
  <slot v-if="isMobile" />
  <TooltipRoot v-else :delay-duration="400">
    <TooltipTrigger as-child><slot /></TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        :side-offset="4"
        class="z-50 flex items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-popover"
      >
        {{ content }}
        <Kbd v-if="shortcut" :keys="shortcut" class="opacity-80" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
