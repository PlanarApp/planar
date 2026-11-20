<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue';
import { Plus } from 'lucide-vue-next';
import type { JSONContent } from '@tiptap/core';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Button, Dialog, Input, Select } from '../ui';
import { db, useQuery } from '../sync';
import { AssigneePicker, DueDatePicker, PriorityPicker, StatusPicker, createTask } from '../tasks';
import { useMembers, useStatuses } from '../tasks/dictionaries';
import { openTask } from '../views/open';
import { ui } from './hotkeys';

/** Quick task creation from anywhere: "+ Create" and the C key. */
const props = defineProps<{
  /** initial description (creation from a selection); by default — empty */
  description?: JSONContent | null;
  /** the description field opens expanded; by default — collapsed under "+ Description" */
  descriptionOpen?: boolean;
}>();
// the editor (tiptap) — only once the field is expanded
const Editor = defineAsyncComponent(() => import('../task/editor/Editor.vue'));
const { t } = useI18n();
const LAST = 'planar.quickCreate.project';
const open = computed({ get: () => ui.create, set: (v) => (ui.create = v) });

const all = useQuery(() => db.table<Row<'projects'>>('projects').toArray());
const spaces = useQuery(() => db.table<Row<'spaces'>>('spaces').toArray());
const options = computed(() => {
  const name = new Map((spaces.value ?? []).map((s) => [s.id, s.name]));
  return (all.value ?? [])
    .filter((p) => !p.archivedAt)
    .map((p) => ({ value: p.id, label: `${name.get(p.spaceId) ?? ''} / ${p.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

const projectId = ref('');
const title = ref('');
const statusId = ref<string>();
const assignees = ref<string[]>([]);
const priority = ref(0);
const due = ref<string | null>(null);
const description = ref<JSONContent | null>(null);
const descOpen = ref(false);
const more = ref(false); // "create another": the dialog stays open
const busy = ref(false);

const spaceId = computed(() => all.value?.find((p) => p.id === projectId.value)?.spaceId ?? '');
const statuses = useStatuses(spaceId, projectId);
const members = useMembers(spaceId);
const memberList = computed(() => (members.value ?? []).map((m) => ({ id: m.id, name: m.name })));
// default status: the first todo, otherwise the first one
watch(
  [statuses, projectId],
  () => {
    const st = (statuses.value ?? []).filter((s) => s.projectId === projectId.value);
    if (!st.some((s) => s.id === statusId.value))
      statusId.value = (st.find((s) => s.category === 'todo') ?? st[0])?.id;
  },
  { immediate: true },
);

const pickProject = () => {
  let last = '';
  try {
    last = localStorage.getItem(LAST) ?? '';
  } catch {
    /* without storage — the first project */
  }
  const ids = new Set(options.value.map((o) => o.value));
  projectId.value =
    [ui.createProject, last].find((x) => x && ids.has(x)) ?? options.value[0]?.value ?? '';
};
// the dialog mounts already open — reset at once; projects may arrive later
watch(
  open,
  (o) => {
    if (!o) return;
    title.value = '';
    assignees.value = [];
    priority.value = 0;
    due.value = null;
    description.value = props.description ?? null;
    descOpen.value = !!props.descriptionOpen;
    pickProject();
  },
  { immediate: true },
);
watch(options, () => open.value && !projectId.value && pickProject());

const form = ref<HTMLFormElement>();

/** keep — "create another" (the checkbox or Ctrl/Cmd+Enter): clear the name and focus it */
async function submit(keep = more.value) {
  const name = title.value.trim();
  if (!name || !projectId.value || !statusId.value || busy.value) return;
  busy.value = true;
  try {
    const id = await createTask({
      projectId: projectId.value,
      statusId: statusId.value,
      title: name,
      priority: priority.value,
      dueDate: due.value,
      assigneeIds: assignees.value,
      description: description.value as Row<'tasks'>['description'],
    });
    try {
      localStorage.setItem(LAST, projectId.value);
    } catch {
      /* not a big deal */
    }
    if (keep) {
      title.value = '';
      description.value = null;
      descOpen.value = false;
      await nextTick();
      form.value?.querySelector<HTMLInputElement>('[data-testid=quick-title]')?.focus();
    } else {
      open.value = false;
      openTask(id); // the server issues the task number — we open by id
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open" :title="t('quick.title')" size="md">
    <form
      id="quick-create"
      ref="form"
      class="flex flex-col gap-3"
      @submit.prevent="submit()"
      @keydown.ctrl.enter.prevent="submit(true)"
      @keydown.meta.enter.prevent="submit(true)"
    >
      <Input
        v-model="title"
        :label="t('quick.name')"
        :placeholder="t('quick.placeholder')"
        autofocus
        data-testid="quick-title"
      />
      <button
        v-if="!descOpen"
        type="button"
        class="inline-flex items-center gap-1 self-start rounded-md text-sm text-fg-muted outline-none hover:text-fg focus-visible:ring-2 ring-focus"
        data-testid="quick-description-toggle"
        :aria-expanded="false"
        @click="descOpen = true"
      >
        <Plus :size="14" aria-hidden="true" />{{ t('quick.description') }}
      </button>
      <div
        v-else
        class="max-h-[40dvh] min-h-20 overflow-y-auto rounded-md border border-border px-3 py-2 text-base focus-within:ring-2 ring-focus"
        data-testid="quick-description"
      >
        <!-- markdown and @mentions as in the task description; no image/files — no attachments -->
        <Editor
          v-model="description"
          :members="memberList"
          :label="t('task.description')"
          :placeholder="t('task.descriptionPlaceholder')"
          refs
        />
      </div>
      <Select v-model="projectId" :label="t('quick.project')" :options="options" />
      <div v-if="spaceId" class="flex flex-wrap items-center gap-2">
        <StatusPicker v-model="statusId" :space-id="spaceId" :project-id="projectId" />
        <AssigneePicker v-model="assignees" :space-id="spaceId" />
        <PriorityPicker v-model="priority" />
        <DueDatePicker v-model="due" />
      </div>
      <p v-if="!options.length" class="text-sm text-fg-muted">{{ t('quick.noProjects') }}</p>
    </form>
    <template #footer>
      <label class="mr-auto flex items-center gap-2 text-sm text-fg-muted">
        <input v-model="more" type="checkbox" />{{ t('quick.more') }}
      </label>
      <Button @click="open = false">{{ t('list.cancel') }}</Button>
      <Button
        type="submit"
        form="quick-create"
        variant="primary"
        :disabled="!title.trim() || !projectId || busy"
        data-testid="quick-submit"
        >{{ t('quick.create') }}</Button
      >
    </template>
  </Dialog>
</template>
