<script setup lang="ts">
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { routerKey, useRoute } from 'vue-router';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  CircleDot,
  Eye,
  EyeOff,
  Flag,
  MoreHorizontal,
  AppWindow,
  Maximize2,
  PanelRight,
  Tag,
  Users,
  X,
} from 'lucide-vue-next';
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
import { useSpaces, useTask } from '../tasks/queries';
import { AvatarStack, Button, IconButton, Menu, useBreakpoint, type MenuItem } from '../ui';
import { taskOpenMode, type TaskOpenMode } from '../views/open';
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
// родитель подзадачи — звено крошек
const parent = useTask(() => props.task.parentId ?? '');
// хлебные крошки: пространство / проект
const spaces = useSpaces();
const crumbs = computed(() => {
  const s = spaces.value?.find((x) => x.id === props.task.spaceId);
  return { space: s?.name ?? '', project: s?.projects.find((p) => p.id === props.task.projectId) };
});
// статус — плашкой своего цвета, как в ClickUp
const statusColor = computed(
  () => statuses.value?.find((s) => s.id === props.task.statusId)?.color ?? null,
);
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
const { isMobile } = useBreakpoint();
const menu = computed<MenuItem[]>(() => [
  ...menuFor(props.task)
    .filter((it) => !('id' in it) || it.id !== 'open')
    .map((it) => ('id' in it && it.id === 'delete' ? { ...it, onSelect: remove } : it)),
]);
const OPEN_MODES = [
  { id: 'modal', icon: AppWindow },
  { id: 'side', icon: PanelRight },
  { id: 'page', icon: Maximize2 },
] as const;
// смена режима применяется сразу: панель ↔ страница — переход, окно ↔ боковая — на месте
function setOpenMode(m: TaskOpenMode) {
  taskOpenMode.value = m;
  if (!router) return;
  const key = props.task.key;
  if (props.mode === 'panel' && m === 'page') void router.replace(`/t/${encodeURIComponent(key)}`);
  else if (props.mode === 'page' && m !== 'page')
    void router.replace({
      name: 'project',
      params: { projectId: props.task.projectId },
      query: { task: key },
    });
}
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
      '@container flex h-full w-full flex-col bg-bg',
      mode === 'page' && 'mx-auto max-w-7xl',
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
      <nav
        class="flex min-w-0 flex-1 items-center gap-1 text-sm text-fg-muted"
        aria-label="breadcrumb"
      >
        <span class="truncate max-md:hidden">{{ crumbs.space }}</span>
        <ChevronRight v-if="crumbs.space" :size="14" class="shrink-0 max-md:hidden" />
        <RouterLink
          v-if="crumbs.project && router"
          :to="`/p/${crumbs.project.id}`"
          class="truncate rounded px-1 hover:bg-bg-muted hover:text-fg"
          >{{ crumbs.project.name }}</RouterLink
        >
        <ChevronRight v-if="crumbs.project" :size="14" class="shrink-0" />
        <template v-if="task.parentId && parent">
          <button
            type="button"
            class="min-w-0 truncate rounded px-1 hover:bg-bg-muted hover:text-fg"
            data-testid="crumb-parent"
            @click="open(parent.key)"
          >
            <span class="font-mono text-xs">{{ parent.key }}</span> {{ parent.title }}
          </button>
          <ChevronRight :size="14" class="shrink-0" />
        </template>
        <span class="shrink-0 font-mono text-xs text-fg">{{ task.key }}</span>
      </nav>
      <!-- «Открывать как» — переключатель иконок, как в ClickUp/Plane -->
      <div
        v-if="!isMobile && router"
        role="group"
        :aria-label="t('task.openAs.label')"
        class="flex items-center rounded-md border border-border p-0.5"
        data-testid="open-as"
      >
        <button
          v-for="m in OPEN_MODES"
          :key="m.id"
          type="button"
          :aria-label="t(`task.openAs.${m.id}`)"
          :title="t(`task.openAs.${m.id}`)"
          :aria-pressed="taskOpenMode === m.id"
          :data-mode="m.id"
          :class="[
            'flex size-6 items-center justify-center rounded outline-none focus-visible:ring-2 ring-focus',
            taskOpenMode === m.id ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:text-fg',
          ]"
          @click="setOpenMode(m.id)"
        >
          <component :is="m.icon" :size="14" />
        </button>
      </div>
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

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto @4xl:flex-row @4xl:overflow-hidden">
      <div class="flex min-w-0 flex-1 flex-col gap-6 px-4 py-5 @2xl:px-8 @4xl:overflow-y-auto">
        <header>
          <input
            v-model="title"
            :aria-label="t('task.title')"
            class="h-12 w-full min-w-0 rounded-md bg-transparent px-2 -mx-2 text-2xl font-semibold outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
            @keydown.enter.prevent="commitTitle"
            @keydown.esc.stop.prevent="cancelTitle"
            @blur="commitTitle"
          />
        </header>

        <dl class="grid gap-x-10 gap-y-1 text-sm @2xl:grid-cols-2" data-testid="task-props">
          <div class="flex min-h-9 items-center">
            <dt class="flex w-32 shrink-0 items-center gap-2 text-fg-muted">
              <CircleDot :size="15" />{{ t('tasks.status') }}
            </dt>
            <dd
              class="min-w-0 rounded-md"
              :style="
                statusColor && { background: `color-mix(in srgb, ${statusColor} 16%, transparent)` }
              "
              data-testid="status-pill"
            >
              <StatusPicker
                :model-value="task.statusId"
                :space-id="task.spaceId"
                @update:model-value="(v?: string) => v && updateTask(task.id, { statusId: v })"
              />
            </dd>
          </div>
          <div class="flex min-h-9 items-center">
            <dt class="flex w-32 shrink-0 items-center gap-2 text-fg-muted">
              <Users :size="15" />{{ t('tasks.assignee') }}
            </dt>
            <dd class="min-w-0">
              <AssigneePicker
                :model-value="task.assigneeIds"
                :space-id="task.spaceId"
                @update:model-value="(v: string[]) => setAssignees(task.id, v)"
              />
            </dd>
          </div>
          <div class="flex min-h-9 items-center">
            <dt class="flex w-32 shrink-0 items-center gap-2 text-fg-muted">
              <CalendarDays :size="15" />{{ t('task.dates') }}
            </dt>
            <dd class="flex min-w-0 items-center gap-1">
              <DueDatePicker
                :model-value="task.startDate"
                :label="t('task.startDate')"
                :empty="t('task.start')"
                @update:model-value="(v: string | null) => updateTask(task.id, { startDate: v })"
              />
              <span class="text-fg-subtle">→</span>
              <DueDatePicker
                :model-value="task.dueDate"
                @update:model-value="(v: string | null) => updateTask(task.id, { dueDate: v })"
              />
            </dd>
          </div>
          <div class="flex min-h-9 items-center">
            <dt class="flex w-32 shrink-0 items-center gap-2 text-fg-muted">
              <Flag :size="15" />{{ t('tasks.priorityTitle') }}
            </dt>
            <dd class="min-w-0">
              <PriorityPicker
                :model-value="task.priority"
                @update:model-value="(v: number) => updateTask(task.id, { priority: v })"
              />
            </dd>
          </div>
          <div class="flex min-h-9 items-center">
            <dt class="flex w-32 shrink-0 items-center gap-2 text-fg-muted">
              <Tag :size="15" />{{ t('tasks.labels') }}
            </dt>
            <dd class="min-w-0">
              <LabelPicker
                :model-value="task.labelIds"
                :space-id="task.spaceId"
                @update:model-value="(v: string[]) => setLabels(task.id, v)"
              />
            </dd>
          </div>
          <div class="flex min-h-9 items-center">
            <dt class="flex w-32 shrink-0 items-center gap-2 text-fg-muted">
              <Eye :size="15" />{{ t('task.watchers') }}
            </dt>
            <dd class="flex min-w-0 items-center gap-1">
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
          </div>
        </dl>

        <FieldsBlock :task="task" />

        <section v-if="panels.length" :aria-label="t('task.extensions')">
          <div role="tablist" class="flex flex-wrap gap-1">
            <Button
              v-for="p in panels"
              :key="p.key"
              role="tab"
              size="sm"
              :variant="tab === p.key ? 'primary' : 'secondary'"
              :icon="p.icon"
              :aria-selected="tab === p.key"
              @click="tab = tab === p.key ? null : p.key"
            >
              {{ lt(p.label) }}
            </Button>
          </div>
          <div v-if="panelComponent" class="mt-2 rounded-lg border border-border p-3">
            <component :is="panelComponent" :task-id="task.id" />
          </div>
        </section>

        <section :aria-label="t('task.description')" class="text-base">
          <h3 class="mb-1 text-sm font-medium text-fg-muted">{{ t('task.description') }}</h3>
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
      </div>

      <aside
        class="flex shrink-0 flex-col border-t border-border bg-bg-subtle p-4 @4xl:min-h-0 @4xl:w-96 @4xl:border-t-0 @4xl:border-l"
        :aria-label="t('task.activity')"
      >
        <Feed :task="task" class="@4xl:min-h-0 @4xl:flex-1" />
      </aside>
    </div>
  </article>
</template>
