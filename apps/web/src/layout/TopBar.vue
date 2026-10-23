<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  Bell,
  Download,
  Languages,
  LogOut,
  Monitor,
  Search,
  Moon,
  Settings,
  Sun,
  User,
} from 'lucide-vue-next';
import { Avatar, Button, Menu, useTheme, type MenuItem } from '../ui';
import { ui } from '../command/hotkeys';
import { setLocale } from '../i18n';
import { useAuth } from '../auth/useAuth';
import { useUnread } from '../inbox/queries';

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { theme } = useTheme();
const { logout, user } = useAuth();
const mac = /Mac/i.test(navigator.platform);
const notice = ref('');
const unread = useUnread();

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
  { separator: true },
  {
    id: 'logout',
    label: t('auth.signOut'),
    icon: LogOut,
    onSelect: async () => {
      notice.value = '';
      if (await logout()) await router.push('/login');
      else if (!useAuth().logoutPrompt.open.value) notice.value = t('auth.logoutNeedsNetwork');
    },
  },
];
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-bg px-3">
    <h1 class="flex-1 truncate text-lg font-semibold">
      {{ route.name ? t(`screens.${String(route.name)}`) : t('app.name') }}
    </h1>
    <span v-if="notice" role="alert" class="text-sm text-fg-muted">{{ notice }}</span>
    <button
      type="button"
      :aria-label="t('cmd.open')"
      class="flex size-11 items-center justify-center gap-2 rounded-md border-border text-fg-muted outline-none focus-visible:ring-2 ring-focus md:h-8 md:w-auto md:border md:px-2 md:text-sm"
      @click="ui.palette = true"
    >
      <Search class="size-4" aria-hidden="true" />
      <kbd class="hidden md:inline">{{ mac ? '⌘K' : 'Ctrl K' }}</kbd>
    </button>
    <Button v-if="installEvent" size="sm" :icon="Download" @click="install">
      {{ t('topbar.install') }}
    </Button>
    <RouterLink
      to="/inbox"
      :aria-label="t('topbar.notifications')"
      class="relative flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 ring-focus md:size-8"
    >
      <Bell :size="18" />
      <span
        v-if="unread"
        data-testid="bell-count"
        class="absolute right-0 top-0 min-w-4 rounded-full bg-accent px-1 text-center text-xs text-accent-fg"
        >{{ unread }}</span
      >
    </RouterLink>
    <Menu :items="items()">
      <template #trigger>
        <button
          type="button"
          :aria-label="t('topbar.menu')"
          class="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 ring-focus md:size-8"
        >
          <Avatar
            :name="user?.name ?? 'Planar'"
            :src="user?.avatarFile ? `/files/${user.avatarFile}/preview?w=256` : null"
            size="md"
          />
        </button>
      </template>
    </Menu>
  </header>
</template>
