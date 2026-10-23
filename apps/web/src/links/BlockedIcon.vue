<script setup lang="ts">
import { Ban } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <Ban :size="14" class="shrink-0 text-danger" role="img" :aria-label="t('links.blocked')" />
</template>
