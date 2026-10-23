<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useAuth } from '../auth/useAuth';
import { Button, Dialog } from '../ui';

const { t } = useI18n();
const { logoutPrompt } = useAuth();
</script>

<template>
  <Dialog
    :open="logoutPrompt.open.value"
    :title="t('logoutPending.title')"
    :description="t('logoutPending.text')"
    @update:open="(o: boolean) => o || logoutPrompt.answer(false)"
  >
    <template #footer>
      <Button @click="logoutPrompt.answer(false)">{{ t('auth.cancel') }}</Button>
      <Button variant="danger" @click="logoutPrompt.answer(true)">
        {{ t('logoutPending.confirm') }}
      </Button>
    </template>
  </Dialog>
</template>
