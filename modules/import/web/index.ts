import { Upload } from 'lucide-vue-next';
import { defineWebModule, useRouter } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'import',
  routes: [{ path: '/m/import/', component: () => import('./ImportPage.vue') }],
  nav: [
    {
      id: 'import',
      order: 90,
      label: { ru: 'Импорт', en: 'Import' },
      icon: Upload,
      to: '/m/import/',
    },
  ],
  commands: [
    {
      id: 'import:open',
      label: { ru: 'Импорт задач', en: 'Import tasks' },
      icon: Upload,
      // shortcut: вне setup inject даёт undefined — тогда полная загрузка
      run: () => {
        const router = useRouter();
        if (router) void router.push('/m/import/');
        else window.location.assign('/m/import/');
      },
    },
  ],
});
