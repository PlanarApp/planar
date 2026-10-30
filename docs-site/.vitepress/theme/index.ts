import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';
import ConsentBanner from './ConsentBanner.vue';
import { initConsent } from './analytics';

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'layout-bottom': () => h(ConsentBanner) }),
  enhanceApp() {
    initConsent();
  },
};
