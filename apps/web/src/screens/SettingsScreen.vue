<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useExtensions } from '../modules/registry';
import type { LocalizedText } from '../modules/types';
import { useAuth } from '../auth/useAuth';
import { onMutationError } from '../sync';
import { useSpaces } from '../tasks';
import { Select } from '../ui';
import UsersSettings from './settings/UsersSettings.vue';

const lazy = (n: string) => defineAsyncComponent(() => import(`./settings/${n}Settings.vue`));
const SECTIONS = {
  spaces: { c: lazy('Spaces') },
  members: { c: lazy('Members'), space: true },
  projects: { c: lazy('Projects'), space: true },
  statuses: { c: lazy('Statuses'), space: true },
  labels: { c: lazy('Labels'), space: true },
  modules: { c: lazy('Modules') },
  users: { c: UsersSettings, admin: true },
} as const;
type Id = keyof typeof SECTIONS;

const { t, te, locale } = useI18n();
const route = useRoute();
const { isAdmin } = useAuth();
const builtin = computed(() =>
  (Object.keys(SECTIONS) as Id[]).filter((s) => isAdmin.value || !('admin' in SECTIONS[s])),
);
// страницы включённых модулей (section = <moduleId>:<id>) — после встроенных
const modPages = useExtensions('settings');
const pages = computed(() => modPages.value.filter((p) => isAdmin.value || !p.adminOnly));
const label = (l: LocalizedText) =>
  typeof l === 'object' ? l[locale.value as 'ru' | 'en'] : te(l) ? t(l) : l;
const items = computed(() => [
  ...builtin.value.map((s) => ({ key: s as string, label: t(`settings.${s}`) })),
  ...pages.value.map((p) => ({ key: p.key, label: label(p.label) })),
]);
const param = computed(() => route.params.section as string | undefined);
const page = computed(() => pages.value.find((p) => p.key === param.value));
const active = computed<string>(() =>
  page.value ? page.value.key : (builtin.value.find((s) => s === param.value) ?? 'spaces'),
);
const modComp = computed(
  () => page.value && defineAsyncComponent(() => page.value!.component().then((m) => m.default)),
);
const sec = computed(() => (page.value ? undefined : SECTIONS[active.value as Id]));

const spaces = useSpaces();
const spaceId = ref('');
watch(
  spaces,
  (all) => {
    if (!all?.some((s) => s.id === spaceId.value)) spaceId.value = all?.[0]?.id ?? '';
  },
  { immediate: true },
);
const spaceOptions = computed(() =>
  (spaces.value ?? []).map((s) => ({ value: s.id, label: s.name })),
);

// ошибка, пришедшая с сервера после локального применения
const serverError = ref('');
onMutationError((e) => (serverError.value = e.message || t('auth.failed')));
</script>

<template>
  <div class="flex flex-col gap-4 p-4 md:flex-row">
    <nav :class="[param ? 'hidden md:flex' : 'flex', 'flex-col gap-1 md:w-48']">
      <h1 class="mb-2 text-xl font-semibold">{{ t('screens.settings') }}</h1>
      <RouterLink
        v-for="s in items"
        :key="s.key"
        :to="`/settings/${s.key}`"
        :data-testid="`nav-${s.key}`"
        class="flex h-11 items-center rounded-md px-2 text-sm hover:bg-bg-muted md:h-7"
        :class="{ 'bg-bg-muted font-medium': s.key === active }"
        >{{ s.label }}</RouterLink
      >
    </nav>
    <div :class="[param ? 'flex' : 'hidden md:flex', 'min-w-0 flex-1 flex-col gap-3']">
      <RouterLink to="/settings" class="text-sm underline md:hidden">{{
        t('screens.settings')
      }}</RouterLink>
      <p v-if="serverError" role="alert" class="text-sm text-danger">{{ serverError }}</p>
      <Select
        v-if="sec && 'space' in sec"
        v-model="spaceId"
        :label="t('settings.space')"
        :options="spaceOptions"
      />
      <component :is="modComp ?? sec!.c" :space-id="spaceId" />
    </div>
  </div>
</template>
