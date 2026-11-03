import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  Archive,
  Copy,
  FolderPlus,
  Link,
  Pencil,
  Settings,
  Star,
  StarOff,
  Trash2,
} from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import type { MenuItem } from '../ui/Menu.vue';
import { toast } from '../ui/toast';
import { db, mutate, newId, rankBetween } from '../sync';
import { defaultModules } from '../api/defaultModules';
import { favorites, type NavSpace } from './nav';

const STATUSES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as const;

const TRANSLIT: Record<string, string> = Object.fromEntries(
  'А:A Б:B В:V Г:G Д:D Е:E Ё:E Ж:ZH З:Z И:I Й:Y К:K Л:L М:M Н:N О:O П:P Р:R С:S Т:T У:U Ф:F Х:H Ц:C Ч:CH Ш:SH Щ:SH Ы:Y Э:E Ю:YU Я:YA'
    .split(' ')
    .map((p) => p.split(':') as [string, string]),
);

/** Project key from the name: Latin (Cyrillic — transliterated) and digits, 2–6 chars, no collisions. */
export function projectKey(name: string, taken: Set<string>): string {
  const base =
    [...name.toUpperCase()]
      .map((c) => TRANSLIT[c] ?? c)
      .join('')
      .replace(/[^A-Z0-9]/g, '')
      .replace(/^[0-9]+/, '')
      .slice(0, 6) || 'P';
  const head = base.length >= 2 ? base : `${base}R`;
  if (!taken.has(head)) return head;
  for (let i = 2; ; i++) {
    const k = `${head.slice(0, 9 - String(i).length)}${i}`;
    if (!taken.has(k)) return k;
  }
}

/** Sidebar actions: "…" menu / right click, inline creation and renaming. */
export function useSidebarActions() {
  const { t } = useI18n();
  const router = useRouter();
  /** id of the entity being renamed now, or "new:<spaceId>" / "new-space" for creation */
  const editing = ref<string | null>(null);
  const draft = ref('');

  const start = (id: string, value = '') => {
    editing.value = id;
    draft.value = value;
  };
  const cancel = () => (editing.value = null);
  /** Blur of a creation field while the menu that started it is still open is the menu's focus trap, not a cancel (Menu gives the focus back). */
  const blurNew = () => {
    if (!document.querySelector('[role=menu]')) cancel();
  };

  async function commit(): Promise<void> {
    const id = editing.value;
    const v = draft.value.trim();
    editing.value = null;
    if (!id || !v) return;
    if (id === 'new-space') {
      const spaces = await db.table<Row<'spaces'>>('spaces').toArray();
      const last =
        spaces
          .map((s) => s.rank)
          .sort()
          .at(-1) ?? null;
      return mutate('space.create', {
        id: newId(),
        name: v,
        rank: rankBetween(last, null),
        memberId: newId(),
      });
    }
    if (id.startsWith('new:')) {
      const spaceId = id.slice(4);
      const all = await db.table<Row<'projects'>>('projects').toArray();
      const last =
        all
          .filter((p) => p.spaceId === spaceId)
          .map((p) => p.rank)
          .sort()
          .at(-1) ?? null;
      const pid = newId();
      const modules = await defaultModules();
      await mutate('project.create', {
        ...(modules && { modules }),
        id: pid,
        spaceId,
        name: v,
        key: projectKey(v, new Set(all.map((p) => p.key))),
        rank: rankBetween(last, null),
        // statuses belong to a project (PJ-1): the default five, named in the current language
        statusIds: STATUSES.map(() => newId()),
        statusNames: Object.fromEntries(
          STATUSES.map((c) => [c, t(`settings.statusDefaults.${c}`)]),
        ),
      });
      void router.push(`/p/${pid}`);
      return;
    }
    if (id.startsWith('space:')) return mutate('space.update', { id: id.slice(6), name: v });
    return mutate('project.update', { id, name: v });
  }

  const copyLink = (path: string) =>
    navigator.clipboard
      ?.writeText(new URL(path, location.origin).href)
      .then(() => toast(t('sidebar.linkCopied'), 2500));

  const spaceItems = (s: NavSpace): MenuItem[] => [
    {
      id: 'new',
      label: t('sidebar.newProject'),
      icon: FolderPlus,
      onSelect: () => start(`new:${s.id}`),
    },
    {
      id: 'fav',
      label: t(favorites.has('space', s.id) ? 'sidebar.unfavorite' : 'sidebar.favorite'),
      icon: favorites.has('space', s.id) ? StarOff : Star,
      onSelect: () => favorites.toggle({ kind: 'space', id: s.id, name: s.name, to: `/s/${s.id}` }),
    },
    {
      id: 'rename',
      label: t('sidebar.rename'),
      icon: Pencil,
      onSelect: () => start(`space:${s.id}`, s.name),
    },
    {
      id: 'settings',
      label: t('sidebar.spaceSettings'),
      icon: Settings,
      onSelect: () => void router.push(`/s/${s.id}/settings`),
    },
    { separator: true },
    {
      id: 'delete',
      label: t('sidebar.delete'),
      icon: Trash2,
      danger: true,
      confirm: {
        title: t('sidebar.deleteSpace', { name: s.name }),
        description: t('sidebar.deleteSpaceHint'),
        confirmLabel: t('sidebar.delete'),
      },
      onSelect: () => void mutate('space.delete', { id: s.id }),
    },
  ];

  const projectItems = (p: NavSpace['projects'][number]): MenuItem[] => {
    const fav = favorites.has('project', p.id);
    return [
      {
        id: 'rename',
        label: t('sidebar.rename'),
        icon: Pencil,
        onSelect: () => start(p.id, p.name),
      },
      {
        id: 'fav',
        label: t(fav ? 'sidebar.unfavorite' : 'sidebar.favorite'),
        icon: fav ? StarOff : Star,
        onSelect: () =>
          favorites.toggle({
            kind: 'project',
            id: p.id,
            name: p.name,
            to: `/p/${p.id}`,
          }),
      },
      {
        id: 'link',
        label: t('sidebar.copyLink'),
        icon: Link,
        onSelect: () => void copyLink(`/p/${p.id}`),
      },
      {
        id: 'open',
        label: t('sidebar.openNewTab'),
        icon: Copy,
        onSelect: () => void window.open(`/p/${p.id}`, '_blank'),
      },
      {
        id: 'settings',
        label: t('sidebar.projectSettings'),
        icon: Settings,
        onSelect: () => void router.push(`/p/${p.id}/settings`),
      },
      { separator: true },
      {
        id: 'archive',
        label: t('sidebar.archive'),
        icon: Archive,
        onSelect: () =>
          void mutate('project.update', { id: p.id, archivedAt: new Date().toISOString() }),
      },
      {
        id: 'delete',
        label: t('sidebar.delete'),
        icon: Trash2,
        danger: true,
        confirm: {
          title: t('sidebar.deleteProject', { name: p.name }),
          description: t('sidebar.deleteProjectHint'),
          confirmLabel: t('sidebar.delete'),
        },
        onSelect: () => void mutate('project.delete', { id: p.id }),
      },
    ];
  };

  return { editing, draft, start, cancel, blurNew, commit, spaceItems, projectItems };
}
