import { db, defineWebModule } from '@planar/web/modules';
import { Branch } from './icons';

export const web = defineWebModule({
  id: 'gitlab',
  taskPanels: [
    {
      id: 'mrs',
      label: { ru: 'GitLab', en: 'GitLab' },
      icon: Branch,
      order: 60,
      // merged / total (PLNRAPP-104)
      count: async (taskId) => {
        const mrs = await db.table('gitlabMrs').where('taskId').equals(taskId).toArray();
        return mrs.length ? `${mrs.filter((m) => m.state === 'merged').length}/${mrs.length}` : 0;
      },
      component: () => import('./MrPanel.vue'),
    },
  ],
  settings: [
    // only in the project: its connections to GitLab repositories and the status on MR merge
    {
      id: 'project',
      level: 'project',
      label: { ru: 'GitLab', en: 'GitLab' },
      icon: Branch,
      adminOnly: true,
      component: () => import('./GitlabSettings.vue'),
    },
  ],
});
