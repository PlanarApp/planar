<script setup lang="ts">
import { Inbox, ListChecks, Menu, Search } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import Badge from '../ui/Badge.vue';
import { useUnread } from '../inbox/queries';
import { ui } from '../command/hotkeys';
import { mobileNav } from './nav';

const { t } = useI18n();
const unread = useUnread();
const cell =
  'relative flex h-14 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-2xs text-fg-muted outline-none focus-visible:ring-2 ring-focus';
</script>

<template>
  <nav
    data-testid="bottom-nav"
    class="flex shrink-0 border-t border-border bg-bg-subtle pb-[env(safe-area-inset-bottom)]"
  >
    <RouterLink to="/inbox" :class="cell" active-class="!text-fg">
      <Inbox :size="20" />{{ t('nav.inbox') }}
      <Badge v-if="unread" variant="solid" class="absolute right-1/4 top-1.5">{{ unread }}</Badge>
    </RouterLink>
    <RouterLink to="/my" :class="cell" active-class="!text-fg">
      <ListChecks :size="20" />{{ t('nav.my') }}
    </RouterLink>
    <button type="button" :class="cell" @click="ui.palette = true">
      <Search :size="20" />{{ t('nav.search') }}
    </button>
    <button type="button" :class="cell" @click="mobileNav = true">
      <Menu :size="20" />{{ t('nav.menu') }}
    </button>
  </nav>
</template>
