<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { UserRound } from 'lucide-vue-next';
import { Button } from '../../ui';
import type { MeMode } from './useFilter';

// Me Mode как в ClickUp — один тумблер: работа для меня (назначенные задачи и комментарии)
const me = defineModel<MeMode | null | undefined>({ default: null });
const { t } = useI18n();
</script>

<template>
  <Button
    variant="ghost"
    size="sm"
    :icon="UserRound"
    compact
    data-testid="me-mode"
    :aria-pressed="me === 'mine'"
    :title="t('views.me.hint')"
    :class="me === 'mine' && 'bg-accent-subtle text-fg'"
    @click="me = me === 'mine' ? null : 'mine'"
  >
    {{ t('views.me.title') }}
  </Button>
</template>
