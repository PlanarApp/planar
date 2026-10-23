<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Settings } from 'lucide-vue-next';
import type { TaskView } from '../tasks';
import { Button } from '../ui';
import FieldEditor from './FieldEditor.vue';
import FieldsDialog from './FieldsDialog.vue';
import { setTaskField, useFieldDefs } from './index';

const props = defineProps<{ task: TaskView }>();
const { t } = useI18n();
const defs = useFieldDefs(() => props.task.projectId);
const settings = ref(false);
</script>

<template>
  <section :aria-label="t('fields.title')" data-testid="fields-block">
    <h3 class="mb-1 flex items-center justify-between text-sm font-medium text-fg-muted">
      {{ t('fields.title') }}
      <Button
        size="sm"
        variant="ghost"
        :icon="Settings"
        :aria-label="t('fields.configure')"
        data-testid="fields-configure"
        @click="settings = true"
      />
    </h3>
    <dl class="grid grid-cols-[7rem_1fr] items-center gap-x-2 gap-y-1 text-sm">
      <template v-for="d in defs" :key="d.id">
        <dt class="truncate text-fg-muted">{{ d.name }}</dt>
        <dd>
          <FieldEditor
            :def="d"
            :value="task.fields[d.id]"
            :space-id="task.spaceId"
            @update:value="(v) => setTaskField(task.id, d.id, v)"
          />
        </dd>
      </template>
    </dl>
    <p v-if="defs && !defs.length" class="text-sm text-fg-subtle">{{ t('fields.empty') }}</p>
    <FieldsDialog v-model:open="settings" :project-id="task.projectId" />
  </section>
</template>
