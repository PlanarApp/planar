/// <reference types="vite-plugin-pwa/vue" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
declare module '*.css';
/** the newest release of CHANGELOG.md (vite define) */
declare const __APP_VERSION__: string;
