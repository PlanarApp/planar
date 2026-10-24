import { Zap } from 'lucide-vue-next';
import { defineWebModule } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'automations',
  settings: [
    {
      id: 'rules',
      label: { ru: 'Автоматизации', en: 'Automations' },
      icon: Zap,
      component: () => import('./RulesPage.vue'),
    },
  ],
});
