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
