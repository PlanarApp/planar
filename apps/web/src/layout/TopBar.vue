<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Download, Languages, Monitor, Moon, Settings, Sun, User } from 'lucide-vue-next';
import { Avatar, Button, Menu, useTheme, type MenuItem } from '../ui';
import { setLocale } from '../i18n';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { theme } = useTheme();

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}
const installEvent = ref<InstallEvent | null>(null);
const onPrompt = (e: Event) => {
  e.preventDefault();
  installEvent.value = e as InstallEvent;
};
onMounted(() => window.addEventListener('beforeinstallprompt', onPrompt));
onBeforeUnmount(() => window.removeEventListener('beforeinstallprompt', onPrompt));
const install = async () => {
  await installEvent.value?.prompt();
  installEvent.value = null;
};

const items = (): MenuItem[] => [
  {
    id: 'profile',
    label: t('topbar.profile'),
    icon: User,
    onSelect: () => router.push('/profile'),
  },
  {
    id: 'settings',
    label: t('topbar.settings'),
    icon: Settings,
    onSelect: () => router.push('/settings'),
  },
  { separator: true },
  {
    id: 't-system',
    label: t('topbar.themeSystem'),
    icon: Monitor,
    onSelect: () => (theme.value = 'system'),
  },
  {
    id: 't-light',
    label: t('topbar.themeLight'),
    icon: Sun,
    onSelect: () => (theme.value = 'light'),
  },
  {
    id: 't-dark',
    label: t('topbar.themeDark'),
    icon: Moon,
    onSelect: () => (theme.value = 'dark'),
  },
  { separator: true },
  {
    id: 'lang',
    label: `${t('topbar.language')}: ${locale.value === 'ru' ? 'English' : 'Русский'}`,
    icon: Languages,
    onSelect: () => setLocale(locale.value === 'ru' ? 'en' : 'ru'),
  },
];
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg px-3">
    <h1 class="flex-1 truncate text-lg font-semibold">
      {{ route.name ? t(`screens.${String(route.name)}`) : t('app.name') }}
    </h1>
    <Button v-if="installEvent" size="sm" :icon="Download" @click="install">
      {{ t('topbar.install') }}
    </Button>
    <Menu :items="items()">
      <template #trigger>
        <button
          type="button"
          :aria-label="t('topbar.menu')"
          class="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 ring-focus md:size-8"
        >
          <Avatar name="Planar" size="md" />
        </button>
      </template>
    </Menu>
  </header>
</template>
