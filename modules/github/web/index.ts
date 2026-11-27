import { defineWebModule } from '@planar/web/modules';
import { GithubIcon } from './icons';

export const web = defineWebModule({
  id: 'github',
  settings: [
    // PLNRAPP-890: the workspace connection to github.com (next to GitLab)
    {
      id: 'workspace',
      level: 'workspace',
      label: { ru: 'GitHub', en: 'GitHub' },
      icon: GithubIcon,
      adminOnly: true,
      component: () => import('./GithubSettings.vue'),
    },
  ],
});
