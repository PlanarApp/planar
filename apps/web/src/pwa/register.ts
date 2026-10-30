// тонкая обёртка: виртуальный модуль vite-plugin-pwa не резолвится в vitest, тесты мокают этот файл
export { useRegisterSW } from 'virtual:pwa-register/vue';
