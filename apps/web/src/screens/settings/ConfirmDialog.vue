<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Button, Dialog } from '../../ui';

defineProps<{ title: string }>();
const emit = defineEmits<{ confirm: [] }>();
const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();
</script>

<template>
  <Dialog v-model:open="open" :title="title">
    <slot />
    <template #footer>
      <Button @click="open = false">{{ t('auth.cancel') }}</Button>
      <Button
        variant="danger"
        data-testid="confirm"
        @click="
          emit('confirm');
          open = false;
        "
        >{{ t('settings.delete') }}</Button
      >
    </template>
  </Dialog>
</template>
