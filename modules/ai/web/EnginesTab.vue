<script setup lang="ts">
import { computed, ref } from 'vue';
import { enabledForProject, useSpaces } from '@planar/web/modules';
import AutopilotSection from './AutopilotSection.vue';
import EngineMonitor from './EngineMonitor.vue';
import RetroSection from './RetroSection.vue';
import { tr } from './data';

// PLNRAPP-568: the tab «Монитор движков» of the workspace AI settings — a project or «Все»; for a project its
// «Автопилот» and «Harness ретро», then the engines monitor of the choice;
// PLNRAPP-569: with projectId (the project AI settings) — this project only, no choice
const props = defineProps<{ projectId?: string }>();
const spaces = useSpaces();
// the spaces with projects where the AI module is on (the monitor of another project answers 403)
const groups = computed(() =>
  (spaces.value ?? [])
    .map((s) => ({
      id: s.id,
      name: s.name,
      projects: s.projects.filter((p) => enabledForProject('ai', p.id)),
    }))
    .filter((s) => s.projects.length),
);
const chosen = ref(props.projectId ?? '');
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="ai-engines-tab">
    <label v-if="!projectId" class="flex max-w-xs flex-col gap-1 text-sm"
      >{{ tr('engProject') }}
      <select
        v-model="chosen"
        class="rounded-md border border-border bg-bg px-2 py-1"
        data-testid="ai-engines-project"
      >
        <option value="">{{ tr('engAllProjects') }}</option>
        <optgroup v-for="s in groups" :key="s.id" :label="s.name">
          <option v-for="p in s.projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </optgroup>
      </select>
    </label>
    <template v-if="chosen">
      <AutopilotSection :key="`ap-${chosen}`" :project-id="chosen" />
      <RetroSection :key="`retro-${chosen}`" :project-id="chosen" />
    </template>
    <p v-else class="text-sm text-fg-muted" data-testid="ai-engines-pick">
      {{ tr('engPickProject') }}
    </p>
    <EngineMonitor :key="`mon-${chosen}`" :project-id="chosen || undefined" />
  </section>
</template>
