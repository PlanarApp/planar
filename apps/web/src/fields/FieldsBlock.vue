<script setup lang="ts">
import { computed } from 'vue';
import type { TaskView } from '../tasks';
import FieldEditor from './FieldEditor.vue';
import { setTaskField, useFieldDefs } from './index';

// the project's custom fields — rows of the task properties list (PLNRAPP-99); set up in project settings
const props = defineProps<{
  task: TaskView;
  /** which rows to show (PLNRAPP-830: empty ones — under the form's cut); all by default */
  visible?: (fieldId: string) => boolean;
}>();
const all = useFieldDefs(() => props.task.projectId);
const defs = computed(() => (all.value ?? []).filter((d) => props.visible?.(d.id) ?? true));
</script>

<template>
  <div v-for="d in defs" :key="d.id" class="flex min-h-9 items-center" data-testid="field-row">
    <dt class="w-32 shrink-0 truncate text-fg-muted">{{ d.name }}</dt>
    <dd class="min-w-0 flex-1">
      <FieldEditor
        :def="d"
        :value="task.fields[d.id]"
        :space-id="task.spaceId"
        @update:value="(v) => setTaskField(task.id, d.id, v)"
      />
    </dd>
  </div>
</template>
