import { createApp, defineAsyncComponent, h } from 'vue';
import { useAuth } from './auth/useAuth';
import App from './App.vue';
import { i18n } from './i18n';
import { router } from './router';
import { initModules } from './modules/registry';
import { prefetchProject } from './tasks/queries';
import { initSession } from './session';
import { onMutationError } from './sync';
import { toast } from './ui/toast';
import './styles.css';

const LogoutDialog = defineAsyncComponent(() => import('./sync/LogoutDialog.vue'));
const Toasts = defineAsyncComponent(() => import('./ui/Toasts.vue'));
const { logoutPrompt } = useAuth();

const open = /^\/p\/([0-9a-f-]{36})/.exec(location.pathname);
if (open) prefetchProject(open[1]!);
initSession(router);
initModules();

// show the failed click rather than swallowing it: otherwise the user clicks again
const fail = (e: unknown) =>
  toast(`${i18n.global.t('auth.failed')}: ${e instanceof Error ? e.message || e.name : String(e)}`);
onMutationError((e) => fail(new Error(e.message || e.code)));
addEventListener('unhandledrejection', (e) => fail(e.reason));

const app = createApp({
  render: () => [h(App), logoutPrompt.open.value && h(LogoutDialog), h(Toasts)],
});
app.config.errorHandler = (e) => {
  console.error(e);
  fail(e);
};
app.use(router).use(i18n).mount('#app');
