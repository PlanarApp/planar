<script setup lang="ts">
import { useAuth } from '../auth/useAuth';
import { useI18n } from 'vue-i18n';
import ModulesSettings from './settings/ModulesSettings.vue';

// Page «Модули экземпляра» (/admin/modules): shared modules, instance admin only (PJ-3)
const { isAdmin } = useAuth();
const { t } = useI18n();
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-4 p-4">
    <ModulesSettings v-if="isAdmin" />
    <p v-else role="alert" class="text-sm text-danger">{{ t('auth.failed') }}</p>
  </div>
</template>
