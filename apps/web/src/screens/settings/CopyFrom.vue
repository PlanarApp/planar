<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Button, Select } from '../../ui';
import { db, mutate, newId } from '../../sync';
import { useProject, useSpaces } from '../../tasks';
import { useAction } from './shared';

// "Copy from another project of the space": project.copyDictionaries (same names are skipped)
const props = defineProps<{ projectId: string; kind: 'statuses' | 'labels' }>();
const { t } = useI18n();
const { error, run } = useAction();
const project = useProject(() => props.projectId);
const spaces = useSpaces();
const from = ref<string | null>(null);
const options = computed(() =>
  (spaces.value?.find((s) => s.id === project.value?.spaceId)?.projects ?? [])
    .filter((p) => p.id !== props.projectId)
    .map((p) => ({ value: p.id, label: p.name })),
);

const copy = () =>
  from.value &&
  run(async () => {
    const src = await db
      .table<Row<'statuses'> | Row<'labels'>>(props.kind)
      .where('projectId')
      .equals(from.value!)
      .toArray();
    const pairs = src.map((x) => ({ id: newId(), fromId: x.id }));
    await mutate('project.copyDictionaries', {
      projectId: props.projectId,
      fromProjectId: from.value!,
      statuses: props.kind === 'statuses' ? pairs : [],
      labels: props.kind === 'labels' ? pairs : [],
    });
    from.value = null;
  });
</script>

<template>
  <div v-if="options.length" class="flex flex-wrap items-end gap-2" data-testid="copy-from">
    <Select v-model="from" :label="t('settings.copyFrom')" :options="options" />
    <Button size="sm" :disabled="!from" data-testid="copy-go" @click="copy">{{
      t('settings.copy')
    }}</Button>
    <p v-if="error" role="alert" class="w-full text-sm text-danger">{{ error }}</p>
  </div>
</template>
