<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Input } from '../../ui';
import { mutate, newId } from '../../sync';
import { useLabels } from '../../tasks';
import ColorPicker from './ColorPicker.vue';
import { COLORS } from './colors';
import { useAction, useAdminSpaces } from './shared';

const props = defineProps<{ spaceId: string }>();
const { t } = useI18n();
const { error, run } = useAction();
const isAdmin = useAdminSpaces();
const canEdit = computed(() => isAdmin(props.spaceId));
const labels = useLabels(() => props.spaceId);
const name = ref('');
const color = ref(COLORS[0]);

const create = () =>
  name.value.trim() &&
  run(async () => {
    await mutate('label.create', {
      id: newId(),
      spaceId: props.spaceId,
      name: name.value.trim(),
      color: color.value,
    });
    name.value = '';
  });
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold">{{ t('settings.labels') }}</h2>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <form v-if="canEdit" class="flex flex-wrap items-end gap-2" @submit.prevent="create">
      <Input v-model="name" :label="t('settings.name')" data-testid="label-new" />
      <ColorPicker v-model="color" />
      <Button type="submit" variant="primary">{{ t('auth.create') }}</Button>
    </form>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="l in labels"
        :key="l.id"
        data-testid="label-row"
        class="flex flex-wrap items-end gap-2 py-2"
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
        <Button
          v-if="canEdit"
          size="sm"
          variant="danger"
          data-testid="label-delete"
          @click="run(() => mutate('label.delete', { id: l.id }))"
          >{{ t('settings.delete') }}</Button
        >
      </li>
    </ul>
  </section>
</template>
