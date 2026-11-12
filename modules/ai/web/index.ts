import { Sparkles } from 'lucide-vue-next';
import { defineComponent, h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

/** The same page on every level: the group settings pass spaceId / projectId, the level is fixed here. */
const page = (level: 'workspace' | 'space' | 'project') => async () => {
  const { default: AiSettings } = await import('./AiSettings.vue');
  return {
    default: defineComponent({
      props: { spaceId: String, projectId: String },
      setup: (p) => () => h(AiSettings, { level, spaceId: p.spaceId, projectId: p.projectId }),
    }),
  };
};
const label = { ru: 'ИИ', en: 'AI' };

export const web = defineWebModule({
  id: 'ai',
  taskPanels: [
    {
      id: 'runs',
      label: { ru: 'ИИ', en: 'AI' },
      icon: Sparkles,
      order: 70,
      component: () => import('./TaskAiPanel.vue'),
    },
  ],
  docPanels: [
    { id: 'harness', component: () => import('./HarnessPanel.vue') },
    { id: 'docChat', component: () => import('./DocChatPanel.vue') },
  ],
  settings: [
    {
      id: 'workspace',
      level: 'workspace',
      label,
      icon: Sparkles,
      adminOnly: true,
      component: page('workspace'),
    },
    {
      id: 'tasks',
      level: 'workspace',
      label: { ru: 'Задачи ИИ', en: 'AI tasks' },
      icon: Sparkles,
      adminOnly: true,
      component: () => import('./AiMonitor.vue'),
    },
    { id: 'space', level: 'space', label, icon: Sparkles, component: page('space') },
    { id: 'project', level: 'project', label, icon: Sparkles, component: page('project') },
  ],
});
