import { computed, ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { LogOut, Languages, Monitor, Moon, Settings, Sun, User } from 'lucide-vue-next';
import type { MenuItem } from '../ui/Menu.vue';
import { useTheme } from '../ui/useTheme';
import { setLocale } from '../i18n';
import { useAuth } from '../auth/useAuth';
import { useSpaces } from '../tasks/queries';

const KEY = 'planar.sidebar.collapsed';
const readCollapsed = (): Record<string, boolean> => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};
const collapsed = ref(readCollapsed());
/** Свёрнутые группы боковой панели: id → bool, хранится в localStorage. */
export const sidebarCollapse = {
  is: (id: string) => !!collapsed.value[id],
  toggle(id: string) {
    collapsed.value = { ...collapsed.value, [id]: !collapsed.value[id] };
    try {
      localStorage.setItem(KEY, JSON.stringify(collapsed.value));
    } catch {
      /* без хранилища состояние живёт до перезагрузки */
    }
  },
};

/** Выезжающая боковая панель на mobile. */
export const mobileNav = ref(false);

const notice = ref(''); // общий: показывается в TopBar при любом входе в меню

/** Меню пользователя (профиль, настройки, тема, язык, выход) — в шапке панели и в TopBar на mobile. */
export function useUserMenu() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { logout } = useAuth();
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
  return { items, notice };
}

export interface NavSpace {
  id: string;
  name: string;
  projects: { id: string; name: string; prefix: string }[];
}
export interface NavFavorite {
  id: string;
  name: string;
  to: string;
}

// shortcut: избранное — в localStorage (личное, на этом устройстве); нужна синхронизация между устройствами — сущность на сервере
const FAV_KEY = 'planar.favorites';
const readFav = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const favIds = ref<string[]>(readFav());
/** Избранные проекты: id в порядке добавления. */
export const favoriteProjects = {
  has: (id: string) => favIds.value.includes(id),
  toggle(id: string) {
    favIds.value = favIds.value.includes(id)
      ? favIds.value.filter((x) => x !== id)
      : [...favIds.value, id];
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favIds.value));
    } catch {
      /* без хранилища — до перезагрузки */
    }
  },
};

export function useNavData(): {
  spaces: Readonly<Ref<NavSpace[]>>;
  favorites: Readonly<Ref<NavFavorite[]>>;
} {
  const src = useSpaces();
  const spaces = computed<NavSpace[]>(() =>
    (src.value ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      projects: s.projects.map((p) => ({ id: p.id, name: p.name, prefix: p.key })),
    })),
  );
  const favorites = computed<NavFavorite[]>(() => {
    const byId = new Map(spaces.value.flatMap((s) => s.projects).map((p) => [p.id, p]));
    return favIds.value.flatMap((id) => {
      const p = byId.get(id);
      return p ? [{ id, name: p.name, to: `/p/${id}` }] : [];
    });
  });
  return { spaces, favorites };
}
