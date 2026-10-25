import { Bell } from 'lucide-vue-next';
import { defineWebModule } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'webhooks',
  settings: [
    {
      id: 'webhooks',
      label: { ru: 'Вебхуки', en: 'Webhooks' },
      icon: Bell,
      adminOnly: true,
      component: () => import('./WebhooksSettings.vue'),
    },
  ],
});
