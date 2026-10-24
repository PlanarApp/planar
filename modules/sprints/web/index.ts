import { Zap } from 'lucide-vue-next';
import { defineWebModule } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'sprints',
  views: [
    {
      id: 'sprint',
      label: { ru: 'Спринт', en: 'Sprint' },
      icon: Zap,
      component: () => import('./SprintView.vue'),
    },
  ],
  taskPanels: [
    {
      id: 'cycle',
      label: { ru: 'Спринт', en: 'Sprint' },
      icon: Zap,
      component: () => import('./CyclePanel.vue'),
    },
  ],
});
