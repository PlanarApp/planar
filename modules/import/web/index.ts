import { Upload } from 'lucide-vue-next';
import { defineWebModule, useRouter } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'import',
  routes: [{ path: '/m/import/', component: () => import('./ImportPage.vue') }],
  // import — a section of Workspace settings
  settings: [
    {
      id: 'import',
      label: { ru: 'Импорт', en: 'Import' },
      icon: Upload,
      component: () => import('./ImportPage.vue'),
    },
  ],
  commands: [
    {
      id: 'import:open',
      label: { ru: 'Импорт задач', en: 'Import tasks' },
      icon: Upload,
      // shortcut: outside setup, inject gives undefined — then a full load
      run: () => {
        const router = useRouter();
        if (router) void router.push('/m/import/');
        else window.location.assign('/m/import/');
      },
    },
  ],
});
