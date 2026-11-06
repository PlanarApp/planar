<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppSection from '../../pwa/AppSection.vue';
import { releases } from './changelog';

const { t } = useI18n();
// main open-source components (apps/web, apps/api package.json); links — the projects' home pages
const COMPONENTS = [
  ['Vue', 'https://vuejs.org'],
  ['Vite', 'https://vite.dev'],
  ['Tailwind CSS', 'https://tailwindcss.com'],
  ['Reka UI', 'https://reka-ui.com'],
  ['Lucide', 'https://lucide.dev'],
  ['Tiptap', 'https://tiptap.dev'],
  ['Yjs', 'https://yjs.dev'],
  ['Dexie.js', 'https://dexie.org'],
  ['NestJS', 'https://nestjs.com'],
  ['Fastify', 'https://fastify.dev'],
  ['Drizzle ORM', 'https://orm.drizzle.team'],
  ['PostgreSQL', 'https://www.postgresql.org'],
  ['pgvector', 'https://github.com/pgvector/pgvector'],
  ['Zod', 'https://zod.dev'],
] as const;
const REPO = 'https://gitlab.com/planarhq/planar';
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-6">
    <header class="flex items-center gap-4">
      <img src="/icons/icon-192.png" alt="" class="size-16 rounded-xl" />
      <div class="min-w-0">
        <h2 class="text-xl font-semibold">{{ t('app.name') }}</h2>
        <p class="text-sm text-fg-muted">{{ t('about.slogan') }}</p>
        <p v-if="releases[0]" class="text-sm text-fg-muted" data-testid="about-version">
          {{ t('about.version', { v: releases[0].version }) }} · {{ releases[0].date }}
        </p>
      </div>
    </header>
    <p class="text-sm">{{ t('about.promo') }}</p>
    <AppSection />
    <section class="flex flex-col gap-2" :aria-label="t('about.components')">
      <h2 class="text-lg font-semibold">{{ t('about.components') }}</h2>
      <ul class="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <li v-for="[name, url] in COMPONENTS" :key="name">
          <a :href="url" target="_blank" rel="noopener" class="text-accent hover:underline">{{
            name
          }}</a>
        </li>
      </ul>
    </section>
    <section v-if="releases.length" class="flex flex-col gap-2" :aria-label="t('about.history')">
      <h2 class="text-lg font-semibold">{{ t('about.history') }}</h2>
      <!-- the newest release is open; texts — CHANGELOG.md as is (English) -->
      <details
        v-for="(r, i) in releases"
        :key="r.version"
        :open="i === 0"
        class="text-sm"
        data-testid="about-release"
      >
        <summary class="cursor-pointer font-medium">{{ r.version }} · {{ r.date }}</summary>
        <div v-for="s in r.sections" :key="s.title" class="mt-2 pl-4">
          <h3 class="font-medium text-fg-muted">{{ s.title }}</h3>
          <ul class="list-disc pl-5">
            <li v-for="item in s.items" :key="item">{{ item }}</li>
          </ul>
        </div>
      </details>
    </section>
    <p class="text-sm text-fg-muted">
      {{ t('about.license') }} ·
      <a :href="REPO" target="_blank" rel="noopener" class="text-accent hover:underline">{{
        t('about.source')
      }}</a>
    </p>
  </div>
</template>
