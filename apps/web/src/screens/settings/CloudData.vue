<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../../api/http';
import { useAuth } from '../../auth/useAuth';
import { Button, Input } from '../../ui';
import { useCloudErrors, type CloudState } from './cloud';

// data export/import of a cloud instance (owner only) — a part of «Импорт/Экспорт»
const { t } = useI18n();
const { user, lastSetupInfo } = useAuth();
const shown = computed(() => !!lastSetupInfo.value?.cloud && user.value?.role === 'owner');
const s = ref<CloudState | null>(null);
const busy = ref(false);
const error = ref('');
const name = computed(() => s.value?.domain.split('.')[0] ?? '');
const errText = useCloudErrors(() => s.value?.serverIp);
async function run(f: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await f();
  } catch (e) {
    error.value = errText(e);
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  if (shown.value)
    void run(async () => {
      s.value = await api<CloudState>('GET', '/api/cloud');
    });
});
// import replaces all data and restarts this instance: the archive goes straight to the cloud, then its waiting page
const importFile = ref<File | null>(null);
const importConfirm = ref('');
const importData = () =>
  run(async () => {
    const { url } = await api<{ url: string }>('POST', '/api/cloud/import', {
      confirm: importConfirm.value,
    });
    // a Blob without type sends no content-type: a simple CORS request, no preflight
    const r = await fetch(url, { method: 'POST', body: new Blob([importFile.value!]) }).catch(
      (e: Error) => {
        throw new ApiError(0, 'unavailable', e.message);
      },
    );
    const j = (await r.json().catch(() => ({}))) as { ticket?: string; statusMessage?: string };
    if (!r.ok || !j.ticket) {
      const code = j.statusMessage || 'unavailable';
      throw new ApiError(r.status, code, code, { cloud: code });
    }
    window.location.assign(new URL(`/reset/${j.ticket}`, url).href);
  });
// the archive is built by the cloud; the download goes straight from the cloud (link valid 10 minutes)
const exportData = () =>
  run(async () => {
    window.location.assign((await api<{ url: string }>('POST', '/api/cloud/export')).url);
  });
</script>

<template>
  <div v-if="shown" class="flex flex-col gap-6" data-testid="cloud-data">
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <section class="flex flex-col gap-2">
      <h3 class="font-medium">{{ t('cloud.export') }}</h3>
      <p class="text-sm text-fg-muted">{{ t('cloud.exportHint') }}</p>
      <div>
        <Button size="sm" :loading="busy" data-testid="cloud-export" @click="exportData">{{
          t('cloud.exportGo')
        }}</Button>
      </div>
    </section>

    <section v-if="s && s.status !== 'expired'" class="flex flex-col gap-2">
      <h3 class="font-medium text-danger">{{ t('cloud.import') }}</h3>
      <p class="text-sm text-fg-muted">{{ t('cloud.importHint', { name }) }}</p>
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="importData">
        <input
          type="file"
          accept=".tar"
          :aria-label="t('cloud.importFile')"
          class="text-sm"
          @change="importFile = ($event.target as HTMLInputElement).files?.[0] ?? null"
        />
        <Input v-model="importConfirm" :label="t('cloud.deleteConfirm')" :placeholder="name" />
        <Button
          type="submit"
          variant="danger"
          :loading="busy"
          :disabled="importConfirm !== name || !importFile"
          >{{ t('cloud.importGo') }}</Button
        >
      </form>
    </section>
  </div>
</template>
