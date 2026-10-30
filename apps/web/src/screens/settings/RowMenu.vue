<script setup lang="ts">
import { MoreHorizontal } from 'lucide-vue-next';
import { TooltipProvider } from 'reka-ui';
import { useI18n } from 'vue-i18n';
import { IconButton, Menu, type MenuItem } from '../../ui';

// Own TooltipProvider: the row renders outside App too (tests). The row's "…" list button: on desktop visible on hover/focus/open menu, on mobile always (parent — group).
defineProps<{ items: MenuItem[] }>();
const { t } = useI18n();
</script>

<template>
  <TooltipProvider>
    <Menu :items="items" align="end">
      <template #trigger>
        <IconButton
          :icon="MoreHorizontal"
          :label="t('settings.more')"
          size="sm"
          data-testid="row-menu"
          class="md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100"
        />
      </template>
    </Menu>
  </TooltipProvider>
</template>
