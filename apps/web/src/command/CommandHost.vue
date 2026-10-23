<script setup lang="ts">
import { defineAsyncComponent, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ui, useHotkey } from './hotkeys';

// тяжёлое — лениво, при первом открытии; в начальном чанке только hotkeys
const Palette = defineAsyncComponent(() => import('./Palette.vue'));
const CheatSheet = defineAsyncComponent(() => import('./CheatSheet.vue'));
const palette = ref(false);
const cheat = ref(false);
watch(
  () => ui.palette,
  (v) => v && (palette.value = true),
  { immediate: true },
);
watch(
  () => ui.cheat,
  (v) => v && (cheat.value = true),
  { immediate: true },
);

const router = useRouter();
const route = useRoute();
const { t } = useI18n();
const open = (query = '') => {
  ui.query = query;
  ui.palette = true;
};
useHotkey('mod+k', () => (ui.palette ? (ui.palette = false) : open()), { label: 'cmd.hk.palette' });
useHotkey('/', () => open(), { label: 'cmd.hk.search' });
useHotkey('?', () => (ui.cheat = true), { label: 'cmd.hk.cheat' });
useHotkey(
  'c',
  async () => {
    const c = await import('./commands');
    const p = c.projectOf(route);
    if (p) await c.createIn(p, t('cmd.newTitle'));
    else open(t('cmd.create'));
  },
  { label: 'cmd.hk.create' },
);
useHotkey('g i', () => void router.push('/inbox'), { label: 'cmd.hk.inbox' });
useHotkey('g m', () => void router.push('/my'), { label: 'cmd.hk.my' });
useHotkey('g s', () => void router.push('/settings'), { label: 'cmd.hk.settings' });
</script>

<template>
  <Palette v-if="palette" />
  <CheatSheet v-if="cheat" />
</template>
