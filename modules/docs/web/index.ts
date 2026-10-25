import { FileText } from 'lucide-vue-next';
import { defineWebModule } from '@planar/web/modules';
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
      component: () => import('./TaskPanel.vue'),
    },
  ],
  search: [pageSearch],
  groupTabs: [
    { id: 'pages', tab: 'docs', label: label('docs'), component: () => import('./GroupDocs.vue'),
      branch: () => import('./DocsBranch.vue'),
    },
  ],
});
