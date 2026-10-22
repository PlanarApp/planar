<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuth } from '../auth/useAuth';
import UsersSettings from './settings/UsersSettings.vue';

const { t } = useI18n();
const route = useRoute();
const { isAdmin } = useAuth();
const section = computed(() => route.params.section);
</script>

<template>
  <div class="p-4">
    <h1 class="text-xl font-semibold">{{ t('screens.settings') }}</h1>
    <nav v-if="isAdmin" class="mt-2">
      <RouterLink to="/settings/users" data-testid="nav-users" class="text-sm underline">{{
        t('auth.users')
      }}</RouterLink>
    </nav>
    <UsersSettings v-if="isAdmin && section === 'users'" />
  </div>
</template>
