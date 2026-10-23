<script setup lang="ts">
import { Folder, Inbox, ListChecks, MoreHorizontal } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { Badge } from '../ui';
import { useUnread } from '../inbox/queries';

const { t } = useI18n();
const unread = useUnread();
const items = [
  { to: '/inbox', icon: Inbox, label: 'nav.inbox' },
  { to: '/my', icon: ListChecks, label: 'nav.my' },
  { to: '/p', icon: Folder, label: 'nav.projects' },
  { to: '/settings', icon: MoreHorizontal, label: 'nav.more' },
];
</script>

<template>
  <nav
    data-testid="bottom-nav"
    class="flex shrink-0 border-t border-border bg-bg-subtle pb-[env(safe-area-inset-bottom)]"
  >
    <RouterLink
      v-for="i in items"
      :key="i.to"
      :to="i.to"
      class="flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-fg-muted outline-none focus-visible:ring-2 ring-focus"
      active-class="text-accent"
    >
      <component :is="i.icon" :size="20" />{{ t(i.label) }}
      <Badge v-if="i.to === '/inbox' && unread" variant="solid">{{ unread }}</Badge>
    </RouterLink>
  </nav>
</template>
