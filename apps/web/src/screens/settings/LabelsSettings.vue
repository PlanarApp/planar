<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Input } from '../../ui';
import { mutate, newId } from '../../sync';
import { useLabels, useProject } from '../../tasks';
import ColorPicker from './ColorPicker.vue';
import CopyFrom from './CopyFrom.vue';
import { COLORS } from './colors';
import RowMenu from './RowMenu.vue';
import SectionHeader from './SectionHeader.vue';
import { useAction, useAdminSpaces } from './shared';

const props = defineProps<{ projectId: string }>();
const { t } = useI18n();
const { error, run } = useAction();
const isAdmin = useAdminSpaces();
const project = useProject(() => props.projectId);
const spaceId = computed(() => project.value?.spaceId ?? '');
const canEdit = computed(() => isAdmin(spaceId.value));
const labels = useLabels(spaceId, () => props.projectId);
const name = ref('');
const color = ref(COLORS[0]);

const create = () =>
  name.value.trim() &&
  run(async () => {
    await mutate('label.create', {
      id: newId(),
      projectId: props.projectId,
      name: name.value.trim(),
      color: color.value,
    });
    name.value = '';
  });
</script>

<template>
  <section class="flex flex-col gap-3">
    <SectionHeader :title="t('settings.labels')" :description="t('settings.labelsDesc')">
      <form v-if="canEdit" class="flex flex-wrap items-end gap-2" @submit.prevent="create">
        <Input v-model="name" :label="t('settings.name')" size="sm" data-testid="label-new" />
        <ColorPicker v-model="color" />
        <Button type="submit" variant="primary" size="sm">{{ t('auth.create') }}</Button>
      </form>
    </SectionHeader>
    <CopyFrom v-if="canEdit" :project-id="projectId" kind="labels" />
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="l in labels"
        :key="l.id"
        data-testid="label-row"
        class="group flex items-center gap-2 py-1"
      >
        <Input
          :model-value="l.name"
          :label="t('settings.name')"
          hide-label
          :disabled="!canEdit"
          class="flex-1"
          @change="
            (e: Event) =>
              run(() =>
                mutate('label.update', { id: l.id, name: (e.target as HTMLInputElement).value }),
              )
          "
        />
        <ColorPicker
          :model-value="l.color"
          :disabled="!canEdit"
          @update:model-value="(c) => run(() => mutate('label.update', { id: l.id, color: c }))"
        />
        <RowMenu
          v-if="canEdit"
          :items="[
            {
              id: 'delete',
              label: t('settings.delete'),
              danger: true,
              confirm: {
                title: t('settings.deleteLabel'),
                description: l.name,
                confirmLabel: t('settings.delete'),
              },
              onSelect: () => run(() => mutate('label.delete', { id: l.id })),
            },
          ]"
        />
      </li>
    </ul>
  </section>
</template>
