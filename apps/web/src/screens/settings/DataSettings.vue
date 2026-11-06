<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { useI18n } from 'vue-i18n';
import { enabledForProject, useExtensions } from '../../modules/registry';
import CloudData from './CloudData.vue';
import { IMPORT_PAGE } from './data';
import SectionHeader from './SectionHeader.vue';

// «Импорт/Экспорт»: the import module's page (if it is on) and the cloud data export/import
const { t } = useI18n();
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
  </div>
</template>
