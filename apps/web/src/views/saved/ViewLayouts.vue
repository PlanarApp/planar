<script setup lang="ts">
import type { Component } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button } from '../../ui';

// task view picker — buttons at the top of the «View» menu (PLNRAPP-71)
defineProps<{ items: { value: string; label: string; icon?: Component }[] }>();
const model = defineModel<string>({ default: '' });
const { t } = useI18n();
</script>

<template>
  <div
    role="group"
    :aria-label="t('views.view')"
    class="flex flex-wrap gap-1"
    data-testid="view-layout"
  >
    <Button
      v-for="i in items"
      :key="i.value"
      size="sm"
      :icon="i.icon"
      :variant="model === i.value ? 'primary' : 'secondary'"
      :aria-pressed="model === i.value"
      @click="model = i.value"
    >
      {{ i.label }}
    </Button>
  </div>
</template>
