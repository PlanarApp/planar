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
/** Collapsed sidebar groups: id → bool, stored in localStorage. */
export const sidebarCollapse = {
  is: (id: string) => !!collapsed.value[id],
  toggle(id: string) {
    collapsed.value = { ...collapsed.value, [id]: !collapsed.value[id] };
    try {
      localStorage.setItem(KEY, JSON.stringify(collapsed.value));
    } catch {
      /* without storage the state lives until reload */
    }
  },
};

/** Slide-out sidebar on mobile. */
export const mobileNav = ref(false);

const notice = ref(''); // common: shown in TopBar on any menu entry

/** User menu (profile, settings, theme, language, logout) — in the panel header and in TopBar on mobile. */
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
  color: string | null;
  icon: string | null;
  projects: {
    id: string;
    name: string;
    prefix: string;
    color: string | null;
    icon: string | null;
  }[];
}
/** What can be added to favourites; documents and chats are module entities. */
export type FavKind = 'space' | 'project' | 'doc' | 'chat' | 'task';
/** Favourite link: name and to are a snapshot at the time of adding (space and project — live name). */
export interface FavRef {
  kind: FavKind;
  id: string;
  name: string;
  to: string;
}
export interface NavFavorite extends FavRef {
  key: string;
}

// shortcut: favorites are in localStorage (personal, on this device); cross-device sync needs a server entity
const FAV_KEY = 'planar.favorites';
const readFav = (): FavRef[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]');
    if (!Array.isArray(v)) return [];
    // before favourite types, project ids were stored
    return v.flatMap((x): FavRef[] =>
      typeof x === 'string'
        ? [{ kind: 'project', id: x, name: '', to: `/p/${x}` }]
        : x && typeof x.id === 'string' && typeof x.kind === 'string' && typeof x.to === 'string'
          ? [{ kind: x.kind, id: x.id, name: String(x.name ?? ''), to: x.to }]
          : [],
    );
  } catch {
    return [];
  }
};
const favList = ref<FavRef[]>(readFav());
/** Favourites: in the order they were added. */
export const favorites = {
  has: (kind: FavKind, id: string) => favList.value.some((f) => f.kind === kind && f.id === id),
  toggle(f: FavRef) {
    favList.value = favorites.has(f.kind, f.id)
      ? favList.value.filter((x) => !(x.kind === f.kind && x.id === f.id))
      : [...favList.value, { kind: f.kind, id: f.id, name: f.name, to: f.to }];
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favList.value));
    } catch {
      /* without storage — until reload */
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
      color: s.color,
      icon: s.icon,
      projects: s.projects.map((p) => ({
        id: p.id,
        name: p.name,
        prefix: p.key,
        color: p.color,
        icon: p.icon,
      })),
    })),
  );
  // space and project — live name, deleted ones drop out; the rest — snapshot
  const favs = computed<NavFavorite[]>(() => {
    if (!src.value) return [];
    const sp = new Map(spaces.value.map((s) => [s.id, s.name]));
    const pr = new Map(spaces.value.flatMap((s) => s.projects).map((p) => [p.id, p.name]));
    return favList.value.flatMap((f) => {
      const live = f.kind === 'space' ? sp.get(f.id) : f.kind === 'project' ? pr.get(f.id) : f.name;
      return live ? [{ ...f, name: live, key: `${f.kind}:${f.id}` }] : [];
    });
  });
  return { spaces, favorites: favs };
}
