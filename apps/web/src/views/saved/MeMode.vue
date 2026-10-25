<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDown, UserRound } from 'lucide-vue-next';
import { Button, Menu, type MenuItem } from '../../ui';
import type { MeMode } from './useFilter';

// Me Mode как в ClickUp: только мои задачи вида (назначенные, созданные, отслеживаемые)
const me = defineModel<MeMode | null | undefined>({ default: null });
const { t } = useI18n();
const MODES = ['assigned', 'created', 'watched'] as const;
const items = computed<MenuItem[]>(() => [
  { id: 'all', label: t('views.me.all'), onSelect: () => (me.value = null) },
  { separator: true },
  ...MODES.map((m) => ({ id: m, label: t(`views.me.${m}`), onSelect: () => (me.value = m) })),
]);
</script>

<template>
  <Menu :items="items" align="end">
    <template #trigger>
      <Button
        variant="ghost"
        size="sm"
        :icon="UserRound"
        data-testid="me-mode"
        :aria-pressed="!!me"
        :class="me && 'bg-accent-subtle text-fg'"
      >
        {{ me ? t(`views.me.${me}`) : t('views.me.title') }}
        <ChevronDown :size="12" class="text-fg-subtle" />
      </Button>
    </template>
  </Menu>
</template>
