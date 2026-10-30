// thin wrapper: the virtual module vite-plugin-pwa does not resolve in vitest, tests mock this file
export { useRegisterSW } from 'virtual:pwa-register/vue';
