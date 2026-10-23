<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { VueDraggable } from 'vue-draggable-plus';
import type { Row } from '@planar/shared';
import { Button, Input, Select, Dialog } from '../../ui';
import { mutate, newId, rankBetween } from '../../sync';
import { useStatuses } from '../../tasks';
import ColorPicker from './ColorPicker.vue';
import { COLORS } from './colors';
import { useAction, useAdminSpaces } from './shared';

const CATEGORIES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as const;
type Category = (typeof CATEGORIES)[number];
const props = defineProps<{ spaceId: string }>();
const { t } = useI18n();
const { error, run } = useAction();
const isAdmin = useAdminSpaces();
const canEdit = computed(() => isAdmin(props.spaceId));
const statuses = useStatuses(() => props.spaceId);
// локальные списки для Sortable; источник правды — реплика
const lists = reactive<Record<Category, Row<'statuses'>[]>>({
  backlog: [],
  todo: [],
  in_progress: [],
  done: [],
  cancelled: [],
});
watch(
  statuses,
  (all) => {
    for (const c of CATEGORIES) lists[c] = (all ?? []).filter((s) => s.category === c);
  },
  { immediate: true },
);

const name = ref('');
const category = ref<Category>('todo');
const color = ref(COLORS[0]);
const catOptions = computed(() =>
  CATEGORIES.map((c) => ({ value: c, label: t(`settings.cat.${c}`) })),
);

const create = () =>
  name.value.trim() &&
  run(async () => {
    const last = statuses.value?.at(-1)?.rank ?? null;
    await mutate('status.create', {
      id: newId(),
      spaceId: props.spaceId,
      name: name.value.trim(),
      category: category.value,
      color: color.value,
      rank: rankBetween(last, null),
    });
    name.value = '';
  });

/** Перенос в категорию на позицию index: rank — между соседями без самого статуса. */
function move(id: string, cat: Category, index: number) {
  const others = (statuses.value ?? []).filter((s) => s.category === cat && s.id !== id);
  const rank = rankBetween(others[index - 1]?.rank ?? null, others[index]?.rank ?? null);
  return run(() => mutate('status.update', { id, category: cat, rank }));
}
defineExpose({ move });

const del = ref<Row<'statuses'> | null>(null);
const replaceWith = ref<string | null>(null);
const replaceOptions = computed(() =>
  (statuses.value ?? [])
    .filter((s) => s.id !== del.value?.id)
    .map((s) => ({ value: s.id, label: s.name })),
);
const askDelete = (s: Row<'statuses'>) => {
  del.value = s;
  replaceWith.value = null;
};
async function remove() {
  if (!del.value || !replaceWith.value) return;
  if (
    await run(() => mutate('status.delete', { id: del.value!.id, replaceWith: replaceWith.value }))
  )
    del.value = null;
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <h2 class="text-lg font-semibold">{{ t('settings.statuses') }}</h2>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <form v-if="canEdit" class="flex flex-wrap items-end gap-2" @submit.prevent="create">
      <Input v-model="name" :label="t('settings.name')" data-testid="status-new" />
      <Select v-model="category" :label="t('settings.category')" :options="catOptions" />
      <ColorPicker v-model="color" />
      <Button type="submit" variant="primary">{{ t('auth.create') }}</Button>
    </form>
    <div v-for="c in CATEGORIES" :key="c" :data-testid="`cat-${c}`">
      <h3 class="text-sm font-medium text-fg-muted">{{ t(`settings.cat.${c}`) }}</h3>
      <VueDraggable
        v-model="lists[c]"
        group="statuses"
        :disabled="!canEdit"
        handle=".handle"
        class="flex min-h-8 flex-col divide-y divide-border"
        @update="(e) => move(e.data.id, c, e.newIndex!)"
        @add="(e) => move(e.data.id, c, e.newIndex!)"
      >
        <div
          v-for="s in lists[c]"
          :key="s.id"
          data-testid="status-row"
          class="flex items-end gap-2 py-2"
        >
          <span class="handle mb-2 cursor-grab select-none text-fg-subtle" aria-hidden="true"
            >⋮⋮</span
          >
          <Input
            :model-value="s.name"
            :label="t('settings.name')"
            hide-label
            :disabled="!canEdit"
            class="flex-1"
            @change="
              (e: Event) =>
                run(() =>
                  mutate('status.update', { id: s.id, name: (e.target as HTMLInputElement).value }),
                )
            "
          />
          <ColorPicker
            :model-value="s.color"
            :disabled="!canEdit"
            @update:model-value="(v) => run(() => mutate('status.update', { id: s.id, color: v }))"
          />
          <Button
            v-if="canEdit"
            size="sm"
            variant="danger"
            data-testid="status-delete"
            @click="askDelete(s)"
            >{{ t('settings.delete') }}</Button
          >
        </div>
      </VueDraggable>
    </div>
    <Dialog
      :open="!!del"
      :title="t('settings.deleteStatus')"
      :description="t('settings.replaceWith')"
      @update:open="(v) => !v && (del = null)"
    >
      <Select v-model="replaceWith" :label="t('settings.replaceWith')" :options="replaceOptions" />
      <p v-if="error" role="alert" class="mt-2 text-sm text-danger">{{ error }}</p>
      <template #footer>
        <Button @click="del = null">{{ t('auth.cancel') }}</Button>
        <Button variant="danger" :disabled="!replaceWith" data-testid="confirm" @click="remove">{{
          t('settings.delete')
        }}</Button>
      </template>
    </Dialog>
  </section>
</template>
