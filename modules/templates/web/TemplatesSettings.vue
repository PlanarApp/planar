<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Button, Dialog, Input, Menu, Select, useSpaces, type MenuItem } from '@planar/web/modules';
import {
  createProjectFrom,
  mutate,
  saveProjectAs,
  tr,
  useProjects,
  useTemplates,
  type Key,
} from './data';

const props = defineProps<{ spaceId: string }>();
// страница модуля получает пространство «по умолчанию» без выбора — выбор свой
const spaceId = ref(props.spaceId);
watch(
  () => props.spaceId,
  (v) => (spaceId.value ||= v),
);
const spaces = useSpaces();
const spaceOptions = computed(() =>
  (spaces.value ?? []).map((s) => ({ value: s.id, label: s.name })),
);
const list = useTemplates(() => spaceId.value);
const projects = useProjects(() => spaceId.value);
const err = ref('');
const run = (p: Promise<unknown>) =>
  p.then(
    () => (err.value = ''),
    (e) => (err.value = String(e?.message ?? e)),
  );

const renaming = ref<{ id: string; name: string } | null>(null);
const rename = () => {
  const r = renaming.value;
  renaming.value = null;
  if (r?.name.trim()) run(mutate('templates.update', { id: r.id, name: r.name.trim() }));
};

const creating = ref<{ id: string; name: string; key: string } | null>(null);
const keyOk = computed(() => /^[A-Z][A-Z0-9]{1,9}$/.test(creating.value?.key ?? ''));
const create = () => {
  const c = creating.value;
  creating.value = null;
  if (c) run(createProjectFrom(c.id, c.name.trim(), c.key));
};

const saving = ref<{ projectId: string; name: string } | null>(null);
const projectOptions = computed(() =>
  (projects.value ?? []).map((p) => ({ value: p.id, label: p.name })),
);
const startSave = () => {
  const p = projects.value?.[0];
  saving.value = p ? { projectId: p.id, name: p.name } : null;
};
const saveProject = () => {
  const s = saving.value;
  saving.value = null;
  if (s?.name.trim()) run(saveProjectAs(s.projectId, s.name.trim()));
};

const items = (t: { id: string; kind: string; name: string }): MenuItem[] => [
  ...(t.kind === 'project'
    ? [
        {
          id: 'create',
          label: tr('createProject'),
          onSelect: () => (creating.value = { id: t.id, name: '', key: '' }),
        },
      ]
    : []),
  {
    id: 'rename',
    label: tr('rename'),
    onSelect: () => (renaming.value = { id: t.id, name: t.name }),
  },
  {
    id: 'delete',
    label: tr('delete'),
    danger: true,
    confirm: { title: tr('deleteTitle'), description: t.name, confirmLabel: tr('delete') },
    onSelect: () => void run(mutate('templates.delete', { id: t.id })),
  },
];
const kind = (k: string) => tr(`${k}Kind` as Key);
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="templates-settings">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">{{ tr('title') }}</h2>
      <Button size="sm" :disabled="!projects?.length" @click="startSave">{{
        tr('saveProject')
      }}</Button>
    </div>
    <Select v-model="spaceId" :label="tr('space')" :options="spaceOptions" />
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
    <p v-if="list && !list.length" class="text-sm text-fg-muted">{{ tr('none') }}</p>
    <ul class="flex flex-col divide-y divide-border rounded-lg border border-border">
      <li
        v-for="t in list"
        :key="t.id"
        class="flex items-center gap-2 px-3 py-1.5"
        data-testid="tpl-row"
      >
        <span class="flex-1 truncate text-sm">{{ t.name }}</span>
        <span class="text-xs text-fg-muted">{{ kind(t.kind) }}</span>
        <Menu :items="items(t)" :label="t.name" align="end" />
      </li>
    </ul>

    <Dialog
      :open="!!renaming"
      :title="tr('rename')"
      size="sm"
      @update:open="(v) => !v && (renaming = null)"
    >
      <Input v-if="renaming" v-model="renaming.name" :label="tr('name')" @keydown.enter="rename" />
      <template #footer>
        <Button @click="renaming = null">{{ tr('cancel') }}</Button>
        <Button variant="primary" @click="rename">{{ tr('save') }}</Button>
      </template>
    </Dialog>
    <Dialog
      :open="!!creating"
      :title="tr('createProject')"
      size="sm"
      @update:open="(v) => !v && (creating = null)"
    >
      <div v-if="creating" class="flex flex-col gap-3">
        <Input v-model="creating.name" :label="tr('projectName')" />
        <Input v-model="creating.key" :label="tr('projectKey')" />
      </div>
      <template #footer>
        <Button @click="creating = null">{{ tr('cancel') }}</Button>
        <Button variant="primary" :disabled="!creating?.name.trim() || !keyOk" @click="create">{{
          tr('create')
        }}</Button>
      </template>
    </Dialog>
    <Dialog
      :open="!!saving"
      :title="tr('saveProject')"
      size="sm"
      @update:open="(v) => !v && (saving = null)"
    >
      <div v-if="saving" class="flex flex-col gap-3">
        <Select v-model="saving.projectId" :label="tr('project')" :options="projectOptions" />
        <Input v-model="saving.name" :label="tr('name')" />
      </div>
      <template #footer>
        <Button @click="saving = null">{{ tr('cancel') }}</Button>
        <Button variant="primary" :disabled="!saving?.name.trim()" @click="saveProject">{{
          tr('save')
        }}</Button>
      </template>
    </Dialog>
  </section>
</template>
