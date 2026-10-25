import { Zap } from 'lucide-vue-next';
import { defineWebModule } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'sprints',
  // спринт — в «Отчётах» группы (раньше — вид проекта)
  groupTabs: [
    {
      id: 'sprint',
      tab: 'reports',
      order: 40,
      label: { ru: 'Спринты', en: 'Sprints' },
      component: () => import('./GroupSprint.vue'),
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
