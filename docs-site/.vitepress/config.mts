import { defineConfig } from 'vitepress';

const sidebar = (p: string, t: Record<string, string>) => [
  {
    text: t.group,
    items: [
      { text: t.install, link: `${p}install` },
      { text: t.config, link: `${p}configuration` },
      { text: t.backup, link: `${p}backup-upgrade` },
      { text: t.monitoring, link: `${p}monitoring` },
      { text: 'MCP', link: `${p}mcp` },
      { text: 'REST API', link: `${p}rest` },
      { text: t.modules, link: `${p}modules` },
    ],
  },
];

// GA4 / Yandex Metrika ids come from VITE_GA_ID / VITE_YM_ID at build time (see theme/analytics.ts); no ids in the repo.
export default defineConfig({
  title: 'Planar Docs',
  cleanUrls: true,
  // en is the root locale: sources live in docs-site/en, served from "/"
  rewrites: { 'en/:rest*': ':rest*' },
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Install', link: '/install' },
          { text: 'MCP', link: '/mcp' },
        ],
        sidebar: sidebar('/', {
          group: 'Documentation',
          install: 'Installation',
          config: 'Configuration (.env)',
          backup: 'Backups and upgrades',
          monitoring: 'Monitoring and troubleshooting',
          modules: 'Developing modules',
        }),
      },
    },
    ru: {
      label: 'Русский',
      lang: 'ru',
      link: '/ru/',
      themeConfig: {
        nav: [
          { text: 'Установка', link: '/ru/install' },
          { text: 'MCP', link: '/ru/mcp' },
        ],
        sidebar: sidebar('/ru/', {
          group: 'Документация',
          install: 'Установка',
          config: 'Настройка (.env)',
          backup: 'Бэкапы и обновление',
          monitoring: 'Мониторинг и неполадки',
          modules: 'Разработка модулей',
        }),
      },
    },
  },
});
