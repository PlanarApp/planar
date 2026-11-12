import { useAuth } from './auth/useAuth';
import { lastTab, nodeLanding } from './layout/groups';
import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router';

// without the showcase: DevUiScreen is connected separately and only in dev
const screens = import.meta.glob(['./screens/*Screen.vue', '!./screens/DevUiScreen.vue']);
const screen = (name: string) => screens[`./screens/${name}Screen.vue`];

const MOVED_VIEWS = ['sprints:sprint', 'goals:milestones'];

export const router = createRouter({
  history: typeof window === 'undefined' ? createMemoryHistory() : createWebHistory(),
  routes: [
    { path: '/', redirect: '/w' },
    { path: '/setup', name: 'setup', component: screen('Setup'), meta: { layout: 'none' } },
    { path: '/login', name: 'login', component: screen('Login'), meta: { layout: 'none' } },
    // cloud trial is over: the admin sees only payment (cloud-link)
    { path: '/paywall', name: 'paywall', component: screen('Paywall'), meta: { layout: 'none' } },
    { path: '/profile', name: 'profile', component: screen('Profile') },
    // Inbox moved to Workspace "My work › Activity"
    { path: '/inbox', redirect: { path: '/w/work', query: { w: 'activity' } } },
    // the former «My tasks» screen is the «My day» tab of «My work» (PLANARAPP-52, PLNRAPP-84)
    { path: '/my', redirect: { path: '/w/work', query: { w: 'day' } } },
    { path: '/p/:projectId/v/:viewId', name: 'savedView', component: screen('Group') },
    { path: '/w/:tab?', name: 'workspace', component: screen('Group') },
    { path: '/s/:spaceId/:tab?', name: 'space', component: screen('Group') },
    // :view — group tab (docs, chats, …) or Tasks view key (list, board, …)
    { path: '/p/:projectId/:view?', name: 'project', component: screen('Group') },
    { path: '/t/:key', name: 'task', component: screen('Task') },
    { path: '/settings/:section?', name: 'settings', component: screen('Settings') },
    // shared modules of the instance (PJ-3) — now a section of the Workspace settings (admin only)
    { path: '/admin/modules', redirect: { path: '/w/settings', query: { s: 'instanceModules' } } },
    { path: '/m/:moduleId/:rest(.*)*', name: 'module', component: screen('Module') },
  ],
});

if (import.meta.env.DEV)
  router.addRoute({
    path: '/dev/ui',
    name: 'devUi',
    component: () => import('./screens/DevUiScreen.vue'),
    meta: { layout: 'none' },
  });

router.beforeEach(async (to) => {
  const { user, ready, refresh, setupNeeded, setupInfo, lastSetupInfo } = useAuth();
  if (!ready.value) await refresh();
  const bare = to.meta.layout === 'none';
  if (!user.value) {
    if (to.name === 'setup') return (await setupNeeded()) ? true : '/login';
    if (bare) return true;
    return (await setupNeeded()) ? '/setup' : { path: '/login', query: { redirect: to.fullPath } };
  }
  if (!lastSetupInfo.value) await setupInfo().catch(() => null);
  const expired = !!lastSetupInfo.value?.cloud?.expired;
  if (expired !== (to.name === 'paywall')) return expired ? '/paywall' : '/';
  if (to.name === 'login' || to.name === 'setup') return '/';
  // former group tab "Inbox" — "My work › Activity"
  const seg = String((to.name === 'project' ? to.params.view : to.params.tab) ?? '');
  // bare node address — the last opened tab (by default "My work")
  if (!seg && ['project', 'space', 'workspace'].includes(String(to.name))) {
    const l = nodeLanding(to.path, lastTab.get());
    return { path: l.path, query: { ...l.query, ...to.query }, hash: to.hash, replace: true };
  }
  if (seg === 'inbox' && ['project', 'space', 'workspace'].includes(String(to.name)))
    return {
      path: to.path.replace(/\/inbox$/, '/work'),
      query: { ...to.query, w: 'activity' },
      replace: true,
    };
  // former project views Sprint and Milestones live in group Reports
  if (to.name === 'project' && MOVED_VIEWS.includes(String(to.params.view)))
    return {
      path: `/p/${String(to.params.projectId)}/reports`,
      query: { ...to.query, r: String(to.params.view) },
      replace: true,
    };
  if (to.name === 'module') {
    // module routes are added lazily — wait and repeat the navigation.
    // Settings are not known yet (cold entry) — don't hold the transition: ModuleScreen shows a skeleton and repeats the navigation itself.
    // Without `replace`: the redirect keeps the original push/replace, otherwise the previous page drops out of history (PLNRAPP-184).
    const { ensureModule, modulesKnown } = await import('./modules/registry');
    if (
      modulesKnown() &&
      (await ensureModule(String(to.params.moduleId))) &&
      router.resolve(to.fullPath).name !== 'module'
    )
      return to.fullPath;
  }
  return true;
});
