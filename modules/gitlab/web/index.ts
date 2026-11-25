import { db, defineWebModule } from '@planar/web/modules';
import { defineComponent, h } from 'vue';
import { Branch } from './icons';
import ServersPanel from './ServersPanel.vue';

/** The connections panel as a settings page of a level: the group settings pass spaceId. */
const page = (level: 'workspace' | 'space') =>
  Promise.resolve({
    default: defineComponent({
      props: { spaceId: String, projectId: String },
      setup: (p) => () => h(ServersPanel, { level, spaceId: p.spaceId }),
    }),
  });

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
      // branches / MRs / CI on the cards of the views
      card: true,
      cardComponent: () => import('./CardBadges.vue'),
      badge: true,
    },
  ],
  settings: [
    // workspace: the list of GitLab connections; space: which one it uses
    {
      id: 'workspace',
      level: 'workspace',
      label: { ru: 'GitLab', en: 'GitLab' },
      icon: Branch,
      adminOnly: true,
      component: () => page('workspace'),
    },
    {
      id: 'space',
      level: 'space',
      label: { ru: 'GitLab', en: 'GitLab' },
      icon: Branch,
      adminOnly: true,
      component: () => page('space'),
    },
    // project: the connection it uses, its repositories and the status on MR merge
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
