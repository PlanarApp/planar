import { Repeat } from 'lucide-vue-next';
import { defineWebModule } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'recurring',
  taskPanels: [
    {
      id: 'repeat',
      label: { ru: 'Повтор', en: 'Repeat' },
      icon: Repeat,
      order: 70,
      component: () => import('./RepeatPanel.vue'),
    },
  ],
});
