<script setup lang="ts">
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { routerKey, useRoute } from 'vue-router';
import { Eye, EyeOff, Link, MoreHorizontal, Trash2, X } from 'lucide-vue-next';
import { useAuth } from '../auth/useAuth';
import { mutate, newId } from '../sync';
import {
  AssigneePicker,
  DueDatePicker,
  LabelPicker,
  PriorityPicker,
  StatusPicker,
  deleteTask,
  setAssignees,
  setLabels,
  updateTask,
  useLabels,
  useMembers,
  useStatuses,
  type TaskView,
} from '../tasks';
import { useExtensions } from '../modules/registry';
import { Avatar, Button, Dialog, Menu } from '../ui';
import Attachments from './Attachments.vue';
import Checklist from './Checklist.vue';
import FieldsBlock from '../fields/FieldsBlock.vue';
import Editor from './editor/Editor.vue';
import Feed from './Feed.vue';
import { useUsers, useWatchers } from './queries';
import Subtasks from './Subtasks.vue';
import LinksBlock from '../links/LinksBlock.vue';

const props = defineProps<{ task: TaskView; mode: 'panel' | 'page' }>();
const emit = defineEmits<{ close: [] }>();
const { t, locale } = useI18n();
const { user } = useAuth();
const router = inject(routerKey, null);
const route = router ? useRoute() : null;
const statuses = useStatuses(() => props.task.spaceId);
const members = useMembers(() => props.task.spaceId);
useLabels(() => props.task.spaceId);
const users = useUsers();
const watchers = useWatchers(props.task.id);
const memberList = computed(() => (members.value ?? []).map((m) => ({ id: m.id, name: m.name })));

// --- заголовок
const title = ref(props.task.title);
let savedTitle = props.task.title;
function commitTitle() {
  const s = title.value.trim();
  if (!s) title.value = props.task.title;
  else if (s !== savedTitle) {
    savedTitle = s;
    void updateTask(props.task.id, { title: s });
  }
}
watch(
  () => props.task.title,
  (v) => {
    if (title.value === savedTitle) title.value = v;
    savedTitle = v;
  },
);
function cancelTitle(e: KeyboardEvent) {
  title.value = savedTitle;
  (e.target as HTMLElement).blur();
}

// --- наблюдатели
const mine = computed(() => watchers.value?.find((w) => w.userId === user.value?.id));
const toggleWatch = () =>
  mine.value
    ? mutate('task.unwatch', { taskId: props.task.id })
    : mutate('task.watch', { id: newId(), taskId: props.task.id });

// --- меню, удаление
const confirmDelete = ref(false);
const menu = computed(() => [
  {
    id: 'copy',
    label: t('task.copyLink'),
    icon: Link,
    onSelect: () => {
      navigator.clipboard?.writeText(`${location.origin}/t/${props.task.key}`).catch(() => {}); // буфер может быть запрещён
    },
  },
  {
    id: 'delete',
    label: t('task.delete'),
    icon: Trash2,
    danger: true,
    onSelect: () => (confirmDelete.value = true),
  },
]);
async function remove() {
  confirmDelete.value = false;
  await deleteTask(props.task.id);
  emit('close');
}

// --- открыть подзадачу
function open(key: string) {
  if (!router) return;
  void (props.mode === 'panel'
    ? router.push({ query: { ...route?.query, task: key } })
    : router.push(`/t/${key}`));
}

// --- вложения: перетаскивание на панель
const attachments = ref<InstanceType<typeof Attachments>>();
const onDrop = (e: DragEvent) => {
  if ((e.target as HTMLElement).closest?.('.ProseMirror')) return; // картинка в описании — не вложение
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void attachments.value?.addFiles(files);
};
const onKeydown = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement;
  if (
    e.key === 'Escape' &&
    !el.closest('input, textarea, [contenteditable="true"], [role="listbox"]')
  )
    emit('close');
};

// --- вкладки модулей
const panels = useExtensions('taskPanels');
const tab = ref<string | null>(null);
const active = computed(() => panels.value.find((p) => p.key === tab.value) ?? null);
const lt = (x: string | { ru: string; en: string }) =>
  typeof x === 'string' ? t(x) : (x[locale.value as 'ru' | 'en'] ?? x.ru);
const panelComponent = computed(() => {
  const c = active.value?.component;
  return c ? defineAsyncComponent(() => c().then((m) => m.default)) : null;
});
</script>

<template>
  <article
    :class="[
      'flex h-full flex-col overflow-y-auto bg-bg',
      mode === 'panel' ? 'w-full border-l border-border md:w-[480px]' : 'mx-auto w-full max-w-3xl',
    ]"
    :aria-label="task.key"
    @keydown="onKeydown"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <header class="flex items-center gap-2 border-b border-border p-3">
      <span class="text-sm text-fg-muted">{{ task.key }}</span>
      <input
        v-model="title"
        :aria-label="t('task.title')"
        class="h-11 min-w-0 flex-1 rounded-md bg-transparent px-2 text-xl font-semibold outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus md:h-9"
        @keydown.enter.prevent="commitTitle"
        @keydown.esc.stop.prevent="cancelTitle"
        @blur="commitTitle"
      />
      <Menu :items="menu">
        <template #trigger>
          <Button variant="ghost" :icon="MoreHorizontal" :aria-label="t('task.menu')" />
        </template>
      </Menu>
      <Button
        variant="ghost"
        :icon="X"
        :aria-label="t('task.close')"
        :title="t('task.close') + ' (Esc)'"
        data-testid="close"
        @click="emit('close')"
      />
    </header>

    <div class="flex flex-col gap-5 p-4">
      <dl class="grid grid-cols-[7rem_1fr] items-center gap-x-2 gap-y-1 text-sm">
        <dt class="text-fg-muted">{{ t('tasks.status') }}</dt>
        <dd>
          <StatusPicker
            :model-value="task.statusId"
            :space-id="task.spaceId"
            @update:model-value="(v?: string) => v && updateTask(task.id, { statusId: v })"
          />
        </dd>
        <dt class="text-fg-muted">{{ t('tasks.assignee') }}</dt>
        <dd>
          <AssigneePicker
            :model-value="task.assigneeIds"
            :space-id="task.spaceId"
            @update:model-value="(v: string[]) => setAssignees(task.id, v)"
          />
        </dd>
        <dt class="text-fg-muted">{{ t('tasks.priorityTitle') }}</dt>
        <dd>
          <PriorityPicker
            :model-value="task.priority"
            @update:model-value="(v: number) => updateTask(task.id, { priority: v })"
          />
        </dd>
        <dt class="text-fg-muted">{{ t('tasks.dueDate') }}</dt>
        <dd>
          <DueDatePicker
            :model-value="task.dueDate"
            @update:model-value="(v: string | null) => updateTask(task.id, { dueDate: v })"
          />
        </dd>
        <dt class="text-fg-muted">{{ t('tasks.labels') }}</dt>
        <dd>
          <LabelPicker
            :model-value="task.labelIds"
            :space-id="task.spaceId"
            @update:model-value="(v: string[]) => setLabels(task.id, v)"
          />
        </dd>
        <dt class="text-fg-muted">{{ t('task.watchers') }}</dt>
        <dd class="flex items-center gap-1">
          <Avatar
            v-for="w in watchers"
            :key="w.id"
            size="sm"
            :name="users?.find((u) => u.id === w.userId)?.name ?? '—'"
          />
          <Button
            size="sm"
            variant="ghost"
            :icon="mine ? EyeOff : Eye"
            data-testid="watch"
            @click="toggleWatch"
          >
            {{ mine ? t('task.unwatch') : t('task.watch') }}
          </Button>
        </dd>
      </dl>

      <section :aria-label="t('task.description')">
        <Editor
          :members="memberList"
          :label="t('task.description')"
          :placeholder="t('task.descriptionPlaceholder')"
          image
          :collab="{ name: `task:${task.id}` }"
          @attach="(fs) => attachments?.addFiles(fs)"
        />
      </section>

      <FieldsBlock :task="task" />
      <Subtasks :task="task" :statuses="statuses ?? []" @open="open" />
      <Checklist :task-id="task.id" />
      <Attachments ref="attachments" :task-id="task.id" />
      <LinksBlock :task="task" />
      <Feed :task="task" />

      <section v-if="panels.length" :aria-label="t('task.extensions')">
        <div role="tablist" class="mb-2 flex gap-1">
          <Button
            v-for="p in panels"
            :key="p.key"
            role="tab"
            size="sm"
            :variant="tab === p.key ? 'primary' : 'ghost'"
            :icon="p.icon"
            :aria-selected="tab === p.key"
            @click="tab = tab === p.key ? null : p.key"
          >
            {{ lt(p.label) }}
          </Button>
        </div>
        <component :is="panelComponent" v-if="panelComponent" :task-id="task.id" />
      </section>
    </div>

    <Dialog
      v-model:open="confirmDelete"
      :title="t('task.deleteTitle')"
      :description="t('task.deleteText')"
    >
      <template #footer>
        <Button variant="ghost" @click="confirmDelete = false">{{ t('task.cancel') }}</Button>
        <Button variant="danger" data-testid="confirm-delete" @click="remove">{{
          t('task.delete')
        }}</Button>
      </template>
    </Dialog>
  </article>
</template>
