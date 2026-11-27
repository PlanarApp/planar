import { defineWebModule } from '@planar/web/modules';
import { defineComponent, h } from 'vue';
import type { GithubScope } from '../shared/index.js';
import { GithubIcon } from './icons';

/** The connections panel as a settings page of a level: the group settings pass spaceId / projectId. */
const page = (level: GithubScope) =>
  import('./GithubSettings.vue').then((m) => ({
    default: defineComponent({
      props: { spaceId: String, projectId: String },
      setup: (p) => () => h(m.default, { level, spaceId: p.spaceId, projectId: p.projectId }),
    }),
  }));

const label = { ru: 'GitHub', en: 'GitHub' };

// PLNRAPP-890: github.com connections of the levels workspace / space / project (next to GitLab, as in it)
export const web = defineWebModule({
  id: 'github',
  settings: (['workspace', 'space', 'project'] as const).map((level) => ({
    id: level,
    level,
    label,
    icon: GithubIcon,
    adminOnly: true,
    component: () => page(level),
  })),
});
