<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { MessageSquare } from 'lucide-vue-next';
import { useChatData } from './data';
import { useTexts } from './text';

const tx = useTexts();
const { total } = useChatData();
</script>

<template>
  <RouterLink
    to="/m/chat/"
    data-testid="chat-topbar"
    :aria-label="tx('chat')"
    class="relative inline-flex size-8 items-center justify-center rounded-md text-fg hover:bg-bg-muted"
  >
    <MessageSquare :size="18" />
    <span
      v-if="total > 0"
      data-testid="chat-topbar-count"
      :aria-label="tx('unread', { n: total })"
      class="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 text-accent-fg"
      >{{ total > 99 ? '99+' : total }}</span
    >
  </RouterLink>
</template>
