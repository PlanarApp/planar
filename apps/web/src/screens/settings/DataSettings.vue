<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { useI18n } from 'vue-i18n';
import { enabledForProject, useExtensions } from '../../modules/registry';
import { useAuth } from '../../auth/useAuth';
import CloudData from './CloudData.vue';
import { IMPORT_PAGE } from './data';
import SectionHeader from './SectionHeader.vue';

// «Импорт/Экспорт»: the import module's page (if it is on) and the data export/import — the cloud's own,
// on a self-hosted instance — the ops/ scripts on the server (their archive the cloud import accepts, PLNRAPP-86)
const { t } = useI18n();
const { user, lastSetupInfo } = useAuth();
const selfHosted = computed(() => !lastSetupInfo.value?.cloud && user.value?.role === 'owner');
const pages = useExtensions('settings');
const importPage = computed(() =>
  pages.value.find((p) => p.key === IMPORT_PAGE && enabledForProject(p.moduleId)),
);
const ImportComp = computed(
  () =>
    importPage.value &&
    defineAsyncComponent(() => importPage.value!.component().then((m) => m.default)),
);
</script>

<template>
  <div class="flex flex-col gap-6">
    <SectionHeader :title="t('settings.data')" />
    <component :is="ImportComp" v-if="ImportComp" />
    <CloudData />
    <div v-if="selfHosted" class="flex flex-col gap-6" data-testid="self-data">
      <section class="flex flex-col gap-2">
        <h3 class="font-medium">{{ t('cloud.export') }}</h3>
        <p class="text-sm text-fg-muted">{{ t('settings.selfExportHint') }}</p>
        <code class="w-fit rounded bg-bg-muted px-2 py-1 text-sm">./ops/backup.sh</code>
        <p class="text-sm text-fg-muted">{{ t('settings.selfExportCloud') }}</p>
      </section>
      <section class="flex flex-col gap-2">
        <h3 class="font-medium">{{ t('cloud.import') }}</h3>
        <p class="text-sm text-fg-muted">{{ t('settings.selfImportHint') }}</p>
        <code class="w-fit rounded bg-bg-muted px-2 py-1 text-sm"
          >./ops/restore.sh --force backups/planar-&lt;…&gt;.tar</code
        >
      </section>
    </div>
  </div>
</template>
