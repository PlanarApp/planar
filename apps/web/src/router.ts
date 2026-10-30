import { useAuth } from './auth/useAuth';
import { createMemoryHistory, createRouter, createWebHistory } from 'vue-router';

// без витрины: DevUiScreen подключается отдельно и только в dev
const screens = import.meta.glob(['./screens/*Screen.vue', '!./screens/DevUiScreen.vue']);
const screen = (name: string) => screens[`./screens/${name}Screen.vue`];

const MOVED_VIEWS = ['sprints:sprint', 'goals:milestones'];

export const router = createRouter({
  history: typeof window === 'undefined' ? createMemoryHistory() : createWebHistory(),
  routes: [
    { path: '/', redirect: '/w' },
    { path: '/setup', name: 'setup', component: screen('Setup'), meta: { layout: 'none' } },
    { path: '/login', name: 'login', component: screen('Login'), meta: { layout: 'none' } },
    { path: '/profile', name: 'profile', component: screen('Profile') },
    // Входящие переехали в «Моя работа › Активность» Воркспейса
    { path: '/inbox', redirect: { path: '/w/work', query: { w: 'activity' } } },
    { path: '/my', name: 'my', component: screen('My') },
    { path: '/p/:projectId/v/:viewId', name: 'savedView', component: screen('Group') },
    { path: '/w/:tab?', name: 'workspace', component: screen('Group') },
    { path: '/s/:spaceId/:tab?', name: 'space', component: screen('Group') },
    // :view — таб группы (docs, chats, …) или ключ вида Задач (list, board, …)
    { path: '/p/:projectId/:view?', name: 'project', component: screen('Group') },
    { path: '/t/:key', name: 'task', component: screen('Task') },
    { path: '/settings/:section?', name: 'settings', component: screen('Settings') },
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
  const { user, ready, refresh, setupNeeded } = useAuth();
  if (!ready.value) await refresh();
  const bare = to.meta.layout === 'none';
  if (!user.value) {
    if (to.name === 'setup') return (await setupNeeded()) ? true : '/login';
    if (bare) return true;
    return (await setupNeeded()) ? '/setup' : { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'login' || to.name === 'setup') return '/';
  // бывший таб «Входящие» группы — «Моя работа › Активность»
  const seg = String((to.name === 'project' ? to.params.view : to.params.tab) ?? '');
  if (seg === 'inbox' && ['project', 'space', 'workspace'].includes(String(to.name)))
    return {
      path: to.path.replace(/\/inbox$/, '/work'),
      query: { ...to.query, w: 'activity' },
      replace: true,
    };
  // бывшие виды проекта Спринт и Вехи живут в Отчётах группы
  if (to.name === 'project' && MOVED_VIEWS.includes(String(to.params.view)))
    return {
      path: `/p/${String(to.params.projectId)}/reports`,
      query: { ...to.query, r: String(to.params.view) },
      replace: true,
    };
  if (to.name === 'module') {
    // маршруты модуля добавляются лениво — дождаться и повторить навигацию.
    // Настройки ещё не известны (холодный заход) — не держим переход: ModuleScreen покажет скелетон и сама повторит навигацию.
    const { ensureModule, modulesKnown } = await import('./modules/registry');
    if (
      modulesKnown() &&
      (await ensureModule(String(to.params.moduleId))) &&
      router.resolve(to.fullPath).name !== 'module'
    )
      return { path: to.fullPath, replace: true };
  }
  return true;
});
