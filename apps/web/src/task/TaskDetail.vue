<script setup lang="ts">
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { routerKey, useRoute } from 'vue-router';
import { ArrowLeft, Eye, EyeOff, Link, MoreHorizontal, Trash2, X } from 'lucide-vue-next';
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
import { AvatarStack, Button, IconButton, Menu, type MenuItem } from '../ui';
import Attachments from './Attachments.vue';
import Checklist from './Checklist.vue';
import FieldsBlock from '../fields/FieldsBlock.vue';
import Editor from './editor/Editor.vue';
import Feed from './Feed.vue';
import { useUsers, useWatchers } from './queries';
import Subtasks from './Subtasks.vue';
import { useTaskMenu } from '../tasks/taskMenu';
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

const watcherPeople = computed(() =>
  (watchers.value ?? []).map((w) => ({
    name: users.value?.find((u) => u.id === w.userId)?.name ?? '?',
  })),
);

// --- наблюдатели
const mine = computed(() => watchers.value?.find((w) => w.userId === user.value?.id));
const toggleWatch = () =>
  mine.value
    ? mutate('task.unwatch', { taskId: props.task.id })
    : mutate('task.watch', { id: newId(), taskId: props.task.id });

// --- меню (как контекстное в видах, без «Открыть»), удаление закрывает панель
const menuFor = useTaskMenu(() => props.task.spaceId);
const menu = computed<MenuItem[]>(() =>
  menuFor(props.task)
    .filter((it) => !('id' in it) || it.id !== 'open')
    .map((it) => ('id' in it && it.id === 'delete' ? { ...it, onSelect: remove } : it)),
);
async function remove() {
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
      '@container flex h-full flex-col overflow-y-auto bg-bg',
      mode === 'panel' ? 'w-full border-l border-border' : 'mx-auto w-full max-w-5xl',
    ]"
    :aria-label="task.key"
    @keydown="onKeydown"
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <div class="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
      <IconButton
        class="md:hidden"
        :icon="ArrowLeft"
        :label="t('task.close')"
        data-testid="back"
        @click="emit('close')"
      />
      <span class="font-mono text-xs text-fg-muted">{{ task.key }}</span>
      <span class="flex-1" />
      <Menu :items="menu" align="end">
        <template #trigger>
          <IconButton :icon="MoreHorizontal" :label="t('task.menu')" />
        </template>
      </Menu>
      <IconButton
        class="max-md:hidden"
        :icon="X"
        :label="t('task.close')"
        shortcut="Esc"
        data-testid="close"
        @click="emit('close')"
      />
    </div>

    <div class="grid gap-x-8 gap-y-5 p-4 @2xl:grid-cols-[minmax(0,1fr)_16.5rem] @2xl:px-6">
      <header class="@2xl:col-start-1">
        <input
          v-model="title"
          :aria-label="t('task.title')"
          class="h-11 w-full min-w-0 rounded-md bg-transparent px-2 text-xl font-semibold outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus md:h-10"
          @keydown.enter.prevent="commitTitle"
          @keydown.esc.stop.prevent="cancelTitle"
          @blur="commitTitle"
        />
      </header>

      <aside class="flex flex-col gap-4 @2xl:col-start-2 @2xl:row-span-2 @2xl:row-start-1">
        <dl class="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-y-1 text-sm">
          <dt class="text-xs text-fg-muted">{{ t('tasks.status') }}</dt>
          <dd class="min-h-8">
            <StatusPicker
              :model-value="task.statusId"
              :space-id="task.spaceId"
              @update:model-value="(v?: string) => v && updateTask(task.id, { statusId: v })"
            />
          </dd>
          <dt class="text-xs text-fg-muted">{{ t('tasks.priorityTitle') }}</dt>
          <dd class="min-h-8">
            <PriorityPicker
              :model-value="task.priority"
              @update:model-value="(v: number) => updateTask(task.id, { priority: v })"
            />
          </dd>
          <dt class="text-xs text-fg-muted">{{ t('tasks.assignee') }}</dt>
          <dd class="min-h-8">
            <AssigneePicker
              :model-value="task.assigneeIds"
              :space-id="task.spaceId"
              @update:model-value="(v: string[]) => setAssignees(task.id, v)"
            />
          </dd>
          <dt class="text-xs text-fg-muted">{{ t('tasks.labels') }}</dt>
          <dd class="min-h-8">
            <LabelPicker
              :model-value="task.labelIds"
              :space-id="task.spaceId"
              @update:model-value="(v: string[]) => setLabels(task.id, v)"
            />
          </dd>
          <dt class="text-xs text-fg-muted">{{ t('tasks.dueDate') }}</dt>
          <dd class="min-h-8">
            <DueDatePicker
              :model-value="task.dueDate"
              @update:model-value="(v: string | null) => updateTask(task.id, { dueDate: v })"
            />
          </dd>
          <dt class="text-xs text-fg-muted">{{ t('task.watchers') }}</dt>
          <dd class="flex min-h-8 items-center gap-1">
            <AvatarStack :people="watcherPeople" />
            <Button
              size="sm"
              variant="ghost"
              :icon="mine ? EyeOff : Eye"
              :class="mine ? '' : 'text-fg-subtle'"
              data-testid="watch"
              @click="toggleWatch"
            >
              {{ mine ? t('task.unwatch') : t('task.watch') }}
            </Button>
          </dd>
        </dl>

        <FieldsBlock :task="task" />

        <section v-if="panels.length" :aria-label="t('task.extensions')">
          <div role="tablist" class="mb-2 flex flex-wrap gap-1">
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
      </aside>

      <div class="flex min-w-0 flex-col gap-5 @2xl:col-start-1">
        <section :aria-label="t('task.description')" class="text-base">
          <Editor
            :members="memberList"
            :label="t('task.description')"
            :placeholder="t('task.descriptionPlaceholder')"
            image
            :collab="{ name: `task:${task.id}` }"
            @attach="(fs) => attachments?.addFiles(fs)"
          />
        </section>

        <Subtasks :task="task" :statuses="statuses ?? []" @open="open" />
        <Checklist :task-id="task.id" />
        <Attachments ref="attachments" :task-id="task.id" />
        <LinksBlock
          :task="task"
          class="min-w-0 [&_.flex-wrap>div:last-child]:min-w-40 [&_.flex-wrap>div:last-child]:flex-1"
        />
        <Feed :task="task" />
      </div>
    </div>
  </article>
</template>
