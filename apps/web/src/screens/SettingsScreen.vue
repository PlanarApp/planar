<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
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

const { t } = useI18n();
const route = useRoute();
const { isAdmin } = useAuth();
const ids = computed(() =>
  (Object.keys(SECTIONS) as Id[]).filter((s) => isAdmin.value || !('admin' in SECTIONS[s])),
);
const param = computed(() => route.params.section as string | undefined);
const active = computed<Id>(() => ids.value.find((s) => s === param.value) ?? 'spaces');

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
        v-for="s in ids"
        :key="s"
        :to="`/settings/${s}`"
        :data-testid="`nav-${s}`"
        class="rounded-md px-2 py-2 text-sm hover:bg-bg-muted"
        :class="{ 'bg-bg-muted font-medium': s === active }"
        >{{ t(`settings.${s}`) }}</RouterLink
      >
    </nav>
    <div :class="[param ? 'flex' : 'hidden md:flex', 'min-w-0 flex-1 flex-col gap-3']">
      <RouterLink to="/settings" class="text-sm underline md:hidden">{{
        t('screens.settings')
      }}</RouterLink>
      <p v-if="serverError" role="alert" class="text-sm text-danger">{{ serverError }}</p>
      <Select
        v-if="'space' in SECTIONS[active]"
        v-model="spaceId"
        :label="t('settings.space')"
        :options="spaceOptions"
      />
      <component :is="SECTIONS[active].c" :space-id="spaceId" />
    </div>
  </div>
</template>
