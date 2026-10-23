import { createApp, defineAsyncComponent, h } from 'vue';
import { useAuth } from './auth/useAuth';
import App from './App.vue';
import { i18n } from './i18n';
import { router } from './router';
import { initModules } from './modules/registry';
import { initSession } from './session';
import './styles.css';

const LogoutDialog = defineAsyncComponent(() => import('./sync/LogoutDialog.vue'));
const { logoutPrompt } = useAuth();

initSession(router);
initModules();
createApp({ render: () => [h(App), logoutPrompt.open.value && h(LogoutDialog)] })
  .use(router)
  .use(i18n)
  .mount('#app');
