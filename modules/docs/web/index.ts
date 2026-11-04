import { FileText } from 'lucide-vue-next';
import { db, defineWebModule } from '@planar/web/modules';
import { pageSearch } from './search';
import { label } from './text';

export const web = defineWebModule({
  id: 'docs',
  routes: [{ path: '/m/docs/:pageId?', component: () => import('./PageScreen.vue') }],
  taskPanels: [
    {
      id: 'pages',
      label: label('docs'),
      icon: FileText,
      count: (taskId) => db.table('docsTaskLinks').where('taskId').equals(taskId).count(),
      component: () => import('./TaskPanel.vue'),
    },
  ],
  search: [pageSearch],
  groupTabs: [
    { id: 'pages', tab: 'docs', label: label('docs'), component: () => import('./GroupDocs.vue'),
    },
  ],
});
