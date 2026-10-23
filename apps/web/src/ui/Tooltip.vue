<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui';

defineProps<{ content: string; shortcut?: string }>();
</script>

<template>
  <TooltipRoot :delay-duration="400">
    <TooltipTrigger as-child><slot /></TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        :side-offset="4"
        class="z-50 flex items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs text-bg"
      >
        {{ content }}
        <kbd v-if="shortcut" class="opacity-70">{{ shortcut }}</kbd>
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
