<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Input } from '../../ui';
import { db, mutate, useQuery } from '../../sync';
import { useWorkspace } from '../../tasks';
import ColorPicker from './ColorPicker.vue';
import SectionHeader from './SectionHeader.vue';
import { useAction } from './shared';

// первый раздел настроек группы — параметры самого узла: название, цвет, иконка
const props = defineProps<{
  level?: 'workspace' | 'space' | 'project';
  spaceId?: string;
  projectId?: string;
}>();
const { t } = useI18n();
const { error, run } = useAction();
const ws = useWorkspace();
const row = useQuery(async () =>
  props.level === 'project' && props.projectId
    ? await db.table<Row<'projects'>>('projects').get(props.projectId)
    : props.level === 'space' && props.spaceId
      ? await db.table<Row<'spaces'>>('spaces').get(props.spaceId)
      : undefined,
);
const node = computed(() =>
  !props.level || props.level === 'workspace'
    ? { name: ws.value.name, color: ws.value.color, icon: ws.value.icon }
    : row.value
      ? { name: row.value.name, color: row.value.color, icon: row.value.icon }
      : undefined,
);
function save(patch: { name?: string; color?: string | null; icon?: string | null }) {
  const n = node.value;
  if (!n) return;
  if (patch.name !== undefined && !patch.name.trim()) return;
  void run(() =>
    props.level === 'project'
      ? mutate('project.update', { id: props.projectId!, ...patch })
      : props.level === 'space'
        ? mutate('space.update', { id: props.spaceId!, ...patch })
        : mutate('settings.set', { id: 'workspace', value: { ...n, ...patch } }),
  );
}
const val = (e: Event) => (e.target as HTMLInputElement).value;
</script>

<template>
  <section class="flex max-w-xl flex-col gap-4" data-testid="general-settings">
    <SectionHeader :title="t(`settings.general.${level ?? 'workspace'}`)" />
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <template v-if="node">
      <Input
        :model-value="node.name"
        :label="t('settings.general.name')"
        data-testid="general-name"
        @change="save({ name: val($event).trim() })"
      />
      <div class="flex flex-col gap-1">
        <span class="text-sm text-fg-muted">{{ t('settings.general.color') }}</span>
        <ColorPicker
          :model-value="node.color ?? ''"
          @update:model-value="save({ color: $event })"
        />
      </div>
      <div class="w-40">
        <Input
          :model-value="node.icon ?? ''"
          :label="t('settings.general.icon')"
          :placeholder="t('settings.general.iconHint')"
          data-testid="general-icon"
          @change="save({ icon: val($event).trim().slice(0, 16) || null })"
        />
      </div>
    </template>
  </section>
</template>
