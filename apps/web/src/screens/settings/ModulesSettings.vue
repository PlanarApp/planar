<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { api } from '../../api/http';
import { useAuth } from '../../auth/useAuth';
import { db, mutate, useQuery } from '../../sync';
import { useAction } from './shared';

const { t } = useI18n();
const { isAdmin } = useAuth();
const { error, run } = useAction();
const server = ref<{ id: string; enabled: boolean }[]>([]);
const setting = useQuery(() => db.table<Row<'settings'>>('settings').get('enabled_modules'));
onMounted(() =>
  run(
    async () =>
      (server.value = (await api<{ modules: typeof server.value }>('GET', '/api/modules')).modules),
  ),
);
// включённые — только по реплике; нет строки = ничего не включено (ответ сервера справочный)
const enabled = computed(
  () => new Set(Array.isArray(setting.value?.value) ? (setting.value.value as string[]) : []),
);
function toggle(id: string, on: boolean) {
  const next = new Set(enabled.value);
  if (on) next.add(id);
  else next.delete(id);
  return run(() => mutate('settings.set', { id: 'enabled_modules', value: [...next] }));
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold">{{ t('settings.modules') }}</h2>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <p v-if="!server.length" class="text-sm text-fg-muted">{{ t('sidebar.empty') }}</p>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="m in server"
        :key="m.id"
        data-testid="module-row"
        class="flex items-center gap-3 py-2"
      >
        <label class="flex flex-1 items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            class="size-5"
            :checked="enabled.has(m.id)"
            :disabled="!isAdmin"
            @change="(e) => toggle(m.id, (e.target as HTMLInputElement).checked)"
          />
          {{ m.id }}
        </label>
      </li>
    </ul>
  </section>
</template>
