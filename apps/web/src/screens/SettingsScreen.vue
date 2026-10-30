<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useExtensions } from '../modules/registry';
import type { GroupScope, LocalizedText } from '../modules/types';
import { useAuth } from '../auth/useAuth';
import { onMutationError } from '../sync';
import { useSpaces } from '../tasks';
import { Select, Tabs, useBreakpoint } from '../ui';
import UsersSettings from './settings/UsersSettings.vue';

const lazy = (n: string) => defineAsyncComponent(() => import(`./settings/${n}Settings.vue`));
type Level = GroupScope['level'];
const SECTIONS = {
  general: { c: lazy('General'), level: 'any' },
  spaces: { c: lazy('Spaces'), level: 'workspace' },
  members: { c: lazy('Members'), space: true, level: 'space' },
  projects: { c: lazy('Projects'), space: true, level: 'space' },
  statuses: { c: lazy('Statuses'), space: true, level: 'space' },
  labels: { c: lazy('Labels'), space: true, level: 'space' },
  fields: { c: lazy('Fields'), level: 'project' },
  modules: { c: lazy('Modules'), level: 'workspace' },
  users: { c: UsersSettings, admin: true, level: 'workspace' },
} as const satisfies Record<
  string,
  { level: Level | 'any'; c: unknown; space?: true; admin?: true }
>;
type Id = keyof typeof SECTIONS;

// scope — the group's "Settings" tab: sections of its level, the section — in ?s; without scope — the former /settings screen
const props = defineProps<{ scope?: GroupScope }>();
const level = computed<Level | undefined>(() => props.scope?.level);
const atLevel = (l: Level | 'any' | undefined) =>
  !level.value || l === 'any' || (l ?? 'workspace') === level.value;

const { t, te, locale } = useI18n();
const route = useRoute();
const { isAdmin } = useAuth();
const { isMobile } = useBreakpoint();
const router = useRouter();
const builtin = computed(() =>
  (Object.keys(SECTIONS) as Id[]).filter(
    (s) =>
      (isAdmin.value || !('admin' in SECTIONS[s])) &&
      (props.scope ? atLevel(SECTIONS[s].level) : SECTIONS[s].level !== 'project'),
  ),
);
// pages of enabled modules (section = <moduleId>:<id>) — after the built-in ones
const modPages = useExtensions('settings');
const pages = computed(() =>
  modPages.value.filter((p) => (isAdmin.value || !p.adminOnly) && atLevel(p.level)),
);
const label = (l: LocalizedText) =>
  typeof l === 'object' ? l[locale.value as 'ru' | 'en'] : te(l) ? t(l) : l;
const items = computed(() => [
  ...builtin.value.map((s) => ({
    key: s as string,
    label: t(s === 'general' ? 'settings.general.title' : `settings.${s}`),
  })),
  ...pages.value.map((p) => ({ key: p.key, label: label(p.label) })),
]);
const param = computed(
  () => (props.scope ? route.query.s : route.params.section) as string | undefined,
);
const to = (k: string) => (props.scope ? { query: { ...route.query, s: k } } : `/settings/${k}`);
const page = computed(() => pages.value.find((p) => p.key === param.value));
const active = computed<string>(() =>
  page.value
    ? page.value.key
    : (builtin.value.find((s) => s === param.value) ??
      builtin.value[0] ??
      pages.value[0]?.key ??
      ''),
);
const modComp = computed(
  () => page.value && defineAsyncComponent(() => page.value!.component().then((m) => m.default)),
);
const sec = computed(() =>
  page.value ? undefined : (SECTIONS[active.value as Id] as (typeof SECTIONS)[Id] | undefined),
);
const comp = computed(() => modComp.value ?? (page.value ? undefined : sec.value?.c));

const spaces = useSpaces();
const spaceId = ref('');
watch(
  spaces,
  (all) => {
    if (props.scope) spaceId.value = props.scope.spaceId;
    else if (!all?.some((s) => s.id === spaceId.value)) spaceId.value = all?.[0]?.id ?? '';
  },
  { immediate: true },
);
const spaceOptions = computed(() =>
  (spaces.value ?? []).map((s) => ({ value: s.id, label: s.name })),
);

// an error that came from the server after the local apply
const serverError = ref('');
onMutationError((e) => (serverError.value = e.message || t('auth.failed')));
</script>

<template>
  <div class="flex flex-col gap-4 p-4 md:flex-row">
    <h1 v-if="isMobile && !scope" class="text-xl font-semibold">{{ t('screens.settings') }}</h1>
    <!-- mobile: разделы — горизонтальные вкладки вверху -->
    <Tabs
      v-if="isMobile"
      :model-value="active"
      :label="t('screens.settings')"
      :items="items.map((s) => ({ value: s.key, label: s.label }))"
      @update:model-value="(k) => router.push(to(k))"
    />
    <nav v-else class="flex flex-col gap-1 md:w-48">
      <h1 v-if="!scope" class="mb-2 text-xl font-semibold">{{ t('screens.settings') }}</h1>
      <RouterLink
        v-for="s in items"
        :key="s.key"
        :to="to(s.key)"
        :data-testid="`nav-${s.key}`"
        class="flex h-11 items-center rounded-md px-2 text-sm hover:bg-bg-muted md:h-7"
        :class="{ 'bg-bg-muted font-medium': s.key === active }"
        >{{ s.label }}</RouterLink
      >
    </nav>
    <div class="flex min-w-0 flex-1 flex-col gap-3">
      <p v-if="serverError" role="alert" class="text-sm text-danger">{{ serverError }}</p>
      <Select
        v-if="sec && 'space' in sec && !scope"
        v-model="spaceId"
        :label="t('settings.space')"
        :options="spaceOptions"
      />
      <component
        :is="comp"
        v-if="comp"
        :space-id="spaceId"
        :level="scope?.level"
        v-bind="scope?.projectId ? { projectId: scope.projectId } : {}"
      />
    </div>
  </div>
</template>
