import type { Component } from 'vue';
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router';
import type { Row } from '@planar/shared';
import { db } from '../sync';
import { deleteTask, setAssignees, updateTask } from '../tasks';
import { quickCreate } from './hotkeys';
import { setLocale } from '../i18n';
import { useTheme } from '../ui';
import { useExtensions } from '../modules/registry';
import type { CommandCtx } from '../modules/types';

export interface Cmd {
  id: string;
  label: string;
  group: string;
  icon?: Component;
  shortcut?: string;
  /** confirmation text: the command runs after the second Enter */
  confirm?: string;
  run: () => void | Promise<void>;
}
type T = (key: string, named?: Record<string, unknown>) => string;
const byRank = (a: { rank: string }, b: { rank: string }) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;

export const projectOf = (route: RouteLocationNormalizedLoaded): string | undefined =>
  route.name === 'project' || route.name === 'savedView'
    ? String(route.params.projectId)
    : undefined;

export async function buildCommands(o: {
  t: T;
  locale: string;
  router: Router;
  selected: string[];
  ext: ReturnType<typeof useExtensions<'commands'>>['value'];
}): Promise<Cmd[]> {
  const { t, router } = o;
  const route = router.currentRoute.value;
  const projectId = projectOf(route);
  const go = (g: string, id: string, label: string, to: string, shortcut?: string): Cmd => ({
    id,
    label,
    group: g,
    shortcut,
    run: () => void router.push(to),
  });
  const gNav = t('cmd.groupGo');
  const gNew = t('cmd.groupCreate');
  const gSel = t('cmd.groupSelected');
  const out: Cmd[] = [
    go(gNav, 'go:inbox', t('sidebar.inbox'), '/inbox', 'g i'),
    go(gNav, 'go:my', t('sidebar.my'), '/my', 'g m'),
    go(gNav, 'go:settings', t('sidebar.settings'), '/settings', 'g s'),
  ];

  const [spaces, projects] = await Promise.all([
    db.table<Row<'spaces'>>('spaces').toArray(),
    db.table<Row<'projects'>>('projects').toArray(),
  ]);
  const live = projects.filter((p) => !p.archivedAt).sort(byRank);
  for (const s of spaces.sort(byRank))
    for (const p of live.filter((x) => x.spaceId === s.id))
      out.push(go(gNav, `go:p:${p.id}`, `${t('cmd.toProject')}: ${p.name}`, `/p/${p.id}`));

  for (const p of live.filter((x) => !projectId || x.id === projectId))
    out.push({
      id: `new:${p.id}`,
      label: projectId ? t('cmd.create') : `${t('cmd.create')}: ${p.name}`,
      group: gNew,
      shortcut: projectId ? 'c' : undefined,
      run: () => quickCreate(p.id),
    });

  if (o.selected.length) {
    const ids = o.selected;
    const first = (await db.table<Row<'tasks'>>('tasks').bulkGet(ids)).find(Boolean);
    const each = (f: (id: string) => Promise<void>) => async () => {
      for (const id of ids) await f(id);
    };
    if (first) {
      const [st, ms] = await Promise.all([
        db.table<Row<'statuses'>>('statuses').where('spaceId').equals(first.spaceId).toArray(),
        db
          .table<Row<'spaceMembers'>>('spaceMembers')
          .where('spaceId')
          .equals(first.spaceId)
          .toArray(),
      ]);
      const us = await db.table<Row<'users'>>('users').bulkGet(ms.map((m) => m.userId));
      for (const s of st.sort(byRank))
        out.push({
          id: `sel:status:${s.id}`,
          label: `${t('tasks.status')}: ${s.name}`,
          group: gSel,
          run: each((id) => updateTask(id, { statusId: s.id })),
        });
      for (const u of us)
        if (u && !u.deactivatedAt)
          out.push({
            id: `sel:assignee:${u.id}`,
            label: `${t('tasks.assignee')}: ${u.name}`,
            group: gSel,
            run: each((id) => setAssignees(id, [u.id])),
          });
    }
    for (const p of [0, 1, 2, 3, 4])
      out.push({
        id: `sel:priority:${p}`,
        label: `${t('tasks.priorityTitle')}: ${t(`tasks.priority.${p}`)}`,
        group: gSel,
        run: each((id) => updateTask(id, { priority: p })),
      });
    out.push({
      id: 'sel:delete',
      label: t('cmd.delete', { n: ids.length }),
      group: gSel,
      confirm: t('cmd.deleteConfirm', { n: ids.length }),
      run: each(deleteTask),
    });
  }

  const gApp = t('cmd.groupApp');
  const { theme } = useTheme();
  for (const [v, k] of [
    ['light', 'themeLight'],
    ['dark', 'themeDark'],
    ['system', 'themeSystem'],
  ] as const)
    out.push({
      id: `theme:${v}`,
      label: `${t('topbar.theme')}: ${t(`topbar.${k}`)}`,
      group: gApp,
      run: () => void (theme.value = v),
    });
  out.push({
    id: 'lang',
    label: `${t('topbar.language')}: ${o.locale === 'ru' ? 'English' : 'Русский'}`,
    group: gApp,
    run: () => setLocale(o.locale === 'ru' ? 'en' : 'ru'),
  });
  for (const [id, k] of [
    ['pwa:check', 'cmdCheck'],
    ['pwa:install', 'cmdInstall'],
  ] as const)
    out.push({
      id,
      label: t(`pwa.${k}`),
      group: gApp,
      run: () => void router.push({ name: 'profile', query: { pwa: id.slice(4) } }),
    });

  const ctx: CommandCtx = { route, selectedTaskIds: o.selected, projectId };
  const txt = (x: string | { ru: string; en: string }) =>
    typeof x === 'string' ? t(x) : x[o.locale as 'ru' | 'en'];
  for (const c of o.ext)
    if (!c.when || c.when(ctx))
      out.push({
        id: c.key,
        label: txt(c.label),
        group: c.group ? txt(c.group) : t('cmd.groupModules'),
        icon: c.icon,
        shortcut: c.shortcut,
        run: () => c.run(ctx),
      });
  return out;
}
