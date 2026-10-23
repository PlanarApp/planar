<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <div class="p-4">
    <h1 class="text-xl font-semibold">{{ t('screens.module') }}: {{ $route.params.moduleId }}</h1>
  </div>
</template>
