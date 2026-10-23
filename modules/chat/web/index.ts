import { defineWebModule } from '@planar/web/modules';

const page = () => import('./ChatPage.vue');

export const web = defineWebModule({
  id: 'chat',
  routes: [
    { path: '/m/chat/', component: page },
    { path: '/m/chat/c/:channelId/:messageId?', component: page },
    { path: '/m/chat/c/:channelId/t/:rootId', component: page },
  ],
  // на mobile nav не показывается — вход через topbar
  nav: [{ id: 'channels', order: 5, section: () => import('./Section.vue') }],
  topbar: [{ id: 'chat', order: 5, component: () => import('./Topbar.vue') }],
});
