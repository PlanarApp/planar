<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuth } from '../auth/useAuth';
import { Button, Dialog } from '../ui';

const { t } = useI18n();
const { logoutPrompt } = useAuth();
const key = computed(() =>
  logoutPrompt.kind.value === 'switch' ? 'switchPending' : 'logoutPending',
);
</script>

<template>
  <Dialog
    :open="logoutPrompt.open.value"
    :title="t(`${key}.title`)"
    :description="t(`${key}.text`)"
    @update:open="(o: boolean) => o || logoutPrompt.answer(false)"
  >
    <template #footer>
      <Button @click="logoutPrompt.answer(false)">{{ t('auth.cancel') }}</Button>
      <Button variant="danger" @click="logoutPrompt.answer(true)">
        {{ t(`${key}.confirm`) }}
      </Button>
    </template>
  </Dialog>
</template>
