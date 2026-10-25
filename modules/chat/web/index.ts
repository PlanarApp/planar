import { defineWebModule } from '@planar/web/modules';
import { label } from './text';

const page = () => import('./ChatPage.vue');

export const web = defineWebModule({
  id: 'chat',
  routes: [
    { path: '/m/chat/', component: page },
    { path: '/m/chat/c/:channelId/:messageId?', component: page },
    { path: '/m/chat/c/:channelId/t/:rootId', component: page },
  ],
  // на mobile секция доступна через выезжающую боковую панель (кнопка «меню» в TopBar)
  nav: [{ id: 'channels', order: 5, section: () => import('./Section.vue') }],
  groupTabs: [
    { id: 'channels', tab: 'chats', label: label('chat'), component: () => import('./GroupChats.vue') },
  ],
});
