import { defineWebModule } from '@planar/web/modules';
import { defineComponent, h, ref } from 'vue';
import type { GithubScope } from '../shared/index.js';
import { GithubIcon } from './icons';

/**
 * The connections panel as a settings page of a level: the group settings pass spaceId / projectId.
 * PLNRAPP-891: a project also gets its repositories under the connections.
 */
const page = (level: GithubScope) =>
  Promise.all([import('./GithubSettings.vue'), import('./GithubRepos.vue')]).then(([m, r]) => ({
    default: defineComponent({
      props: { spaceId: String, projectId: String },
      setup: (p) => {
        const reload = ref(0);
        return () => {
          const conns = h(m.default, {
            level,
            spaceId: p.spaceId,
            projectId: p.projectId,
            onChanged: () => reload.value++,
          });
          return level === 'project' && p.projectId
            ? h('div', { class: 'flex flex-col gap-6' }, [
                conns,
                h(r.default, { projectId: p.projectId, reload: reload.value }),
              ])
            : conns;
        };
      },
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
