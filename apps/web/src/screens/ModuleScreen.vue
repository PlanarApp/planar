<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { Boxes } from 'lucide-vue-next';
import { useAuth } from '../auth/useAuth';
import { ensureModule, moduleStatus } from '../modules/registry';
import { Button, EmptyState } from '../ui';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { isAdmin } = useAuth();
const status = computed(() => moduleStatus(String(route.params.moduleId)));
// waits for settings (up to the timeout) and loads the module's frontend; the status updates itself
void ensureModule(String(route.params.moduleId));
// settings arrived after the timeout / the module finished loading — repeat the navigation, the routes are already added
watch(
  status,
  (s) => {
    if (s === 'ready') void router.replace(route.fullPath);
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="status === 'loading'" data-testid="module-loading" class="space-y-3 p-4">
    <div class="h-6 w-48 animate-pulse rounded bg-bg-muted" />
    <div class="h-24 animate-pulse rounded bg-bg-muted" />
  </div>
  <EmptyState
    v-else
    :icon="Boxes"
    :title="t(status === 'off' ? 'screens.moduleOff' : 'screens.moduleError')"
    :description="`${t('screens.module')}: ${$route.params.moduleId}`"
  >
    <template v-if="status === 'off' && isAdmin" #actions>
      <Button @click="router.push('/settings/modules')">{{ t('screens.moduleOffAction') }}</Button>
    </template>
  </EmptyState>
</template>
