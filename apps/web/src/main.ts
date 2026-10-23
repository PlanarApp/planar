import { createApp, h } from 'vue';
import App from './App.vue';
import { i18n } from './i18n';
import { router } from './router';
import { initModules } from './modules/registry';
import { initSession } from './session';
import LogoutDialog from './sync/LogoutDialog.vue';
import './styles.css';

initSession(router);
initModules();
createApp({ render: () => [h(App), h(LogoutDialog)] })
  .use(router)
  .use(i18n)
  .mount('#app');
