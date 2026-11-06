<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuth } from '../auth/useAuth';
import { db, useQuery } from '../sync';

// cloud-link: ≤ 30 days of the trial left — a badge for everyone; admins go to Settings › Cloud
const WARN_DAYS = 30;
const { t } = useI18n();
const { lastSetupInfo, isAdmin } = useAuth();
// settings `cloud` is synced: the badge follows the server's refreshes without a reload
const row = useQuery(() => db.table<{ id: string; value: unknown }>('settings').get('cloud'));
const days = computed(() => {
  if (!lastSetupInfo.value?.cloud) return null;
  const v = (row.value?.value ?? lastSetupInfo.value.cloud) as {
    status?: string | null;
    trialEndsAt?: string | null;
  };
  if (v.status !== 'trial' || !v.trialEndsAt) return null;
  const d = Math.max(0, Math.ceil((Date.parse(v.trialEndsAt) - Date.now()) / 86400_000));
  return d <= WARN_DAYS ? d : null;
});
</script>

<template>
  <component
    :is="isAdmin ? 'RouterLink' : 'span'"
    v-if="days !== null"
    :to="isAdmin ? '/settings/cloud' : undefined"
    class="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-warning"
    data-testid="trial-badge"
    :title="t('cloud.badge', { n: days })"
    :aria-label="t('cloud.badge', { n: days })"
    >{{ t('cloud.badgeShort', { n: days }) }}</component
  >
</template>
