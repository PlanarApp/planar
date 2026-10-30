<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { EmptyState, Select } from '../ui';
import { useSpaces } from '../tasks';
import { groupLevels } from '../layout/groups';
import type { GroupScope } from '../modules/types';

// project report in a group: for a Project — itself, above — the group's project picker (the slot gets projectId)
const props = defineProps<{ scope: GroupScope }>();
const { t } = useI18n();
const spaces = useSpaces();
const projects = computed(() =>
  groupLevels(props.scope, spaces.value ?? [], '').filter((l) => l.projectId),
);
const pick = ref<string | null>(null);
watch(
  projects,
  (ps) => {
    if (!ps.some((p) => p.projectId === pick.value)) pick.value = ps[0]?.projectId ?? null;
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div v-if="scope.level !== 'project' && projects.length" class="shrink-0 px-4 pt-3">
      <Select
        v-model="pick"
        size="sm"
        :label="t('groups.project')"
        :options="projects.map((p) => ({ value: p.projectId!, label: p.title }))"
        class="w-64"
      />
    </div>
    <EmptyState v-if="spaces && !pick" :title="t('groups.noProjects')" />
    <div v-else-if="pick" class="min-h-0 flex-1">
      <slot :project-id="pick" />
    </div>
  </div>
</template>
