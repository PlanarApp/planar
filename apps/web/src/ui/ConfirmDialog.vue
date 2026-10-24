<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Button from './Button.vue';
import Dialog from './Dialog.vue';

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    confirmLabel: string;
    cancelLabel?: string;
    danger?: boolean;
  }>(),
  { danger: true },
);
const emit = defineEmits<{ confirm: [] }>();
const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();

const confirm = () => {
  emit('confirm');
  open.value = false;
};
</script>

<template>
  <Dialog v-model:open="open" size="sm" :title="props.title" :description="props.description">
    <template #footer>
      <!-- «отмена» первая в порядке фокуса: Reka ставит фокус на первый tabbable -->
      <Button variant="ghost" @click="open = false">{{ cancelLabel ?? t('ui.cancel') }}</Button>
      <Button :variant="danger ? 'danger' : 'primary'" @click="confirm">{{ confirmLabel }}</Button>
    </template>
  </Dialog>
</template>
