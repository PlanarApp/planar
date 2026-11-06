<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { enabledForProject, useExtensions } from '../modules/registry';
import type { GroupScope, LocalizedText } from '../modules/types';
import { useAuth } from '../auth/useAuth';
import { onMutationError } from '../sync';
import { useSpaces } from '../tasks';
import { Select, Tabs, useBreakpoint } from '../ui';
import UsersSettings from './settings/UsersSettings.vue';
import { IMPORT_PAGE } from './settings/data';

const lazy = (n: string) => defineAsyncComponent(() => import(`./settings/${n}Settings.vue`));
type Level = GroupScope['level'];
const SECTIONS = {
  general: { c: lazy('General'), level: 'any' },
  spaces: { c: lazy('Spaces'), level: 'workspace' },
  members: { c: lazy('Members'), space: true, level: 'space' },
  projects: { c: lazy('Projects'), space: true, level: 'space' },
  statuses: { c: lazy('Statuses'), level: 'project' },
  labels: { c: lazy('Labels'), level: 'project' },
  fields: { c: lazy('Fields'), level: 'project' },
  modules: { c: lazy('Modules'), level: 'project' },
  projectMembers: { c: lazy('ProjectMembers'), level: 'project' },
  users: { c: UsersSettings, admin: true, level: 'workspace' },
  // without projectId — the shared modules of the instance
  instanceModules: { c: lazy('Modules'), admin: true, level: 'workspace' },
  // the import module's page and the cloud data export/import (PLNRAPP-86)
  data: { c: lazy('Data'), level: 'workspace' },
  // cloud-link: only on an instance hosted in the cloud
  cloud: { c: lazy('Cloud'), admin: true, cloud: true, level: 'workspace' },
  about: { c: lazy('About'), level: 'workspace' },
} as const satisfies Record<
  string,
  { level: Level | 'any'; c: unknown; space?: true; admin?: true; cloud?: true }
>;
type Id = keyof typeof SECTIONS;

// scope — the group's "Settings" tab: sections of its level, the section — in ?s; without scope — the former /settings screen
const props = defineProps<{ scope?: GroupScope }>();
const level = computed<Level | undefined>(() => props.scope?.level);
const atLevel = (l: Level | 'any' | undefined) =>
  !level.value || l === 'any' || (l ?? 'workspace') === level.value;

const { t, te, locale } = useI18n();
const route = useRoute();
const { isAdmin, lastSetupInfo, user } = useAuth();
// pages of enabled modules (section = <moduleId>:<id>) — after the built-in ones
const modPages = useExtensions('settings');
const { isMobile } = useBreakpoint();
const router = useRouter();
// «Импорт/Экспорт» — when there is something in it: the import module is on or the instance is in the cloud
const hasData = computed(
  () =>
    modPages.value.some((p) => p.key === IMPORT_PAGE && enabledForProject(p.moduleId)) ||
    (!!lastSetupInfo.value?.cloud && user.value?.role === 'owner'),
);
const builtin = computed(() =>
  (Object.keys(SECTIONS) as Id[]).filter(
    (s) =>
      (s !== 'data' || hasData.value) &&
      (isAdmin.value || !('admin' in SECTIONS[s])) &&
      (!!lastSetupInfo.value?.cloud || !('cloud' in SECTIONS[s])) &&
      (props.scope ? atLevel(SECTIONS[s].level) : SECTIONS[s].level !== 'project'),
  ),
);
// C-schema v16: a data module's page shows if the module is on in the project / in a project of the space / anywhere (Workspace)
const scopeProjects = (l: Level | undefined) =>
  l === 'project'
    ? (props.scope?.projectId ?? undefined)
    : l === 'space'
      ? spaces.value?.find((s) => s.id === props.scope?.spaceId)?.projects.map((p) => p.id)
      : undefined;
const pages = computed(() =>
  modPages.value.filter(
    (p) =>
      p.key !== IMPORT_PAGE &&
      (isAdmin.value || !p.adminOnly) &&
      atLevel(p.level) &&
      enabledForProject(p.moduleId, scopeProjects(p.level)),
  ),
);
const label = (l: LocalizedText) =>
  typeof l === 'object' ? l[locale.value as 'ru' | 'en'] : te(l) ? t(l) : l;
// about the instance, not its content — at the very bottom, after module pages, behind a divider
const TAIL: Id[] = ['cloud', 'about'];
const item = (s: Id) => ({
  key: s as string,
  label: t(s === 'general' ? 'settings.general.title' : `settings.${s}`),
});
const head = computed(() => [
  ...builtin.value.filter((s) => !TAIL.includes(s)).map(item),
  ...pages.value.map((p) => ({ key: p.key, label: label(p.label) })),
]);
const tail = computed(() => builtin.value.filter((s) => TAIL.includes(s)).map(item));
const items = computed(() => [...head.value, ...tail.value]);
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
        v-for="s in head"
        :key="s.key"
        :to="to(s.key)"
        :data-testid="`nav-${s.key}`"
        class="flex h-11 items-center rounded-md px-2 text-sm hover:bg-bg-muted md:h-7"
        :class="{ 'bg-bg-muted font-medium': s.key === active }"
        >{{ s.label }}</RouterLink
      >
      <hr v-if="tail.length" class="my-1 border-border" data-testid="nav-sep" />
      <RouterLink
        v-for="s in tail"
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
