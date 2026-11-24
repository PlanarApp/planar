<script setup lang="ts">
import { ref } from 'vue';
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui';
import { Avatar } from '../ui';

// PLNRAPP-825: the author of a history entry — an avatar, the name in a hint on hover or click (touch)
defineProps<{ name: string; src?: string | null }>();
const open = ref(false);
</script>

<template>
  <TooltipProvider>
    <TooltipRoot v-model:open="open" :delay-duration="400" disable-closing-trigger>
      <TooltipTrigger as-child>
        <button
          type="button"
          class="inline-flex shrink-0 rounded-full"
          :aria-label="name"
          data-testid="activity-author"
          @click="open = !open"
        >
          <Avatar :name="name" :src="src" size="xs" />
        </button>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side-offset="4"
          class="z-50 rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-popover"
          data-testid="activity-author-hint"
        >
          {{ name }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
