<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { UserRound } from 'lucide-vue-next';
import { Button } from '../../ui';
import type { MeMode } from './useFilter';

// Me Mode as in ClickUp — one toggle: work for me (assigned tasks and comments); on — accent icon
const me = defineModel<MeMode | null | undefined>({ default: null });
const { t } = useI18n();
</script>

<template>
  <Button
    variant="ghost"
    size="sm"
    compact
    data-testid="me-mode"
    :aria-pressed="me === 'mine'"
    :title="t('views.me.hint')"
    @click="me = me === 'mine' ? null : 'mine'"
  >
    <UserRound :size="16" :class="me === 'mine' ? 'text-accent' : 'text-fg-subtle'" />
    <span class="max-md:sr-only">{{ t('views.me.title') }}</span>
  </Button>
</template>
