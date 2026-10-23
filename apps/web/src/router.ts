import { useAuth } from './auth/useAuth';
import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router';

const screen = (name: string) => () => import(`./screens/${name}Screen.vue`);

export const router = createRouter({
  history: typeof window === 'undefined' ? createMemoryHistory() : createWebHistory(),
  routes: [
    { path: '/', redirect: '/my' },
    { path: '/setup', name: 'setup', component: screen('Setup'), meta: { layout: 'none' } },
    { path: '/login', name: 'login', component: screen('Login'), meta: { layout: 'none' } },
    { path: '/profile', name: 'profile', component: screen('Profile') },
    { path: '/inbox', name: 'inbox', component: screen('Inbox') },
    { path: '/my', name: 'my', component: screen('My') },
    { path: '/p/:projectId/v/:viewId', name: 'savedView', component: screen('SavedView') },
    { path: '/p/:projectId/:view?', name: 'project', component: screen('Project') },
    { path: '/t/:key', name: 'task', component: screen('Task') },
    { path: '/settings/:section?', name: 'settings', component: screen('Settings') },
    { path: '/m/:moduleId/:rest(.*)*', name: 'module', component: screen('Module') },
  ],
});

router.beforeEach(async (to) => {
  const { user, ready, refresh, setupNeeded } = useAuth();
  if (!ready.value) await refresh();
  const bare = to.meta.layout === 'none';
  if (!user.value) {
    if (to.name === 'setup') return (await setupNeeded()) ? true : '/login';
    if (bare) return true;
    return (await setupNeeded()) ? '/setup' : { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'login' || to.name === 'setup') return '/';
  if (to.name === 'module') {
    // маршруты модуля добавляются лениво — дождаться и повторить навигацию
    const { ensureModule } = await import('./modules/registry');
    if (
      (await ensureModule(String(to.params.moduleId))) &&
      router.resolve(to.fullPath).name !== 'module'
    )
      return { path: to.fullPath, replace: true };
  }
  return true;
});
