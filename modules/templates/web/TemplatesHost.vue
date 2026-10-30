<script setup lang="ts">
import { ref, watch } from 'vue';
import { Button, Dialog, Input, db } from '@planar/web/modules';
import { createTaskFrom, saveTaskAs, tr, ui, useScoped, useTemplates } from './data';

// project of the open list → space
const space = useScoped(
  () => ui.newTask,
  async (p) => (p ? ((await db.table('projects').get(p))?.spaceId ?? '') : ''),
);
const list = useTemplates(() => space.value ?? '', 'task');
const closeNew = () => void (ui.newTask = null);
const closeSave = () => void (ui.saveTask = null);
const pick = async (id: string) => {
  const p = ui.newTask;
  ui.newTask = null;
  if (p) await createTaskFrom(id, p);
};

const name = ref('');
watch(
  () => ui.saveTask,
  async (id) => void (name.value = id ? ((await db.table('tasks').get(id))?.title ?? '') : ''),
);
const save = async () => {
  const id = ui.saveTask;
  ui.saveTask = null;
  if (id && name.value.trim()) await saveTaskAs(id, name.value.trim());
};
</script>

<template>
  <Dialog :open="!!ui.newTask" :title="tr('pickTask')" @update:open="(v) => !v && closeNew()">
    <p v-if="list && !list.length" class="text-sm text-fg-muted">{{ tr('none') }}</p>
    <ul v-else-if="list" class="flex flex-col gap-1">
      <li v-for="t in list" :key="t.id">
        <button
          type="button"
          class="flex min-h-11 w-full items-center rounded-md px-2 text-left text-sm outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus md:min-h-8"
          @click="pick(t.id)"
        >
          {{ t.name }}
        </button>
      </li>
    </ul>
  </Dialog>
  <Dialog :open="!!ui.saveTask" :title="tr('saveTask')" @update:open="(v) => !v && closeSave()">
    <Input v-model="name" :label="tr('name')" @keydown.enter="save" />
    <template #footer>
      <Button @click="closeSave()">{{ tr('cancel') }}</Button>
      <Button variant="primary" :disabled="!name.trim()" @click="save">{{ tr('save') }}</Button>
    </template>
  </Dialog>
</template>
