<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Search } from 'lucide-vue-next';
import { AvatarStack, useBreakpoint } from '../ui';
import { PriorityIcon, StatusIcon, useMembers, useStatuses, type TaskView } from '../tasks';
import { openTask } from './open';

// Панель планирования (Календарь, Таймлайн): задачи без дат с поиском.
// Десктоп — постоянная колонка, задачу перетаскивают на вид. Мобильная — блокирующий лист по кнопке вида
// (нажатие вне — закрыть); нажатие на задачу выбирает её для размещения.
const props = defineProps<{ tasks: TaskView[] }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ pick: [id: string]; drag: [id: string] }>();
const { t } = useI18n();
const { isMobile } = useBreakpoint();
const q = ref('');
const LIMIT = 200; // shortcut: без виртуализации — первые 200 совпадений; хватит, пока бэклог без дат не огромен
const found = computed(() => {
  const s = q.value.trim().toLowerCase();
  return s
    ? props.tasks.filter(
        (x) => x.title.toLowerCase().includes(s) || x.key.toLowerCase().includes(s),
      )
    : props.tasks;
});
// справочники пространств задач списка: статус и исполнители на карточке
const spaces = computed(() => [...new Set(props.tasks.map((x) => x.spaceId))].sort().join(','));
const statuses = useStatuses(spaces);
const members = useMembers(spaces);
const statusOf = (id: string) => statuses.value?.find((s) => s.id === id);
const peopleOf = (ids: string[]) =>
  ids.map((id) => {
    const u = members.value?.find((m) => m.id === id);
    return {
      name: u?.name ?? '?',
      src: u?.avatarFile ? `/files/${u.avatarFile}/preview?w=256` : null,
    };
  });
function choose(x: TaskView) {
  if (!isMobile.value) return openTask(x.key);
  open.value = false;
  emit('pick', x.id);
}
function dragStart(e: DragEvent, id: string) {
  e.dataTransfer?.setData('text/plain', id);
  emit('drag', id);
}
</script>

<template>
  <div
    v-if="open && isMobile"
    class="absolute inset-0 z-20 bg-overlay"
    data-testid="plan-overlay"
    @click="open = false"
  />
  <!-- десктоп: постоянная колонка справа (родитель — flex-строка); мобильная — лист поверх вида -->
  <aside
    v-if="open || !isMobile"
    :class="[
      'flex flex-col gap-2 border-l border-border bg-surface p-3',
      isMobile ? 'absolute inset-y-0 right-0 z-20 w-80 max-w-[85%] shadow-lg' : 'w-72 shrink-0',
    ]"
    data-testid="plan-panel"
    :aria-label="t('plan.title')"
  >
    <label class="flex h-8 shrink-0 items-center gap-2 rounded-md border border-border-strong px-2">
      <Search :size="14" class="shrink-0 text-fg-subtle" aria-hidden="true" />
      <input
        v-model="q"
        type="search"
        :placeholder="t('plan.search')"
        :aria-label="t('plan.search')"
        class="min-w-0 flex-1 bg-transparent text-sm outline-none"
        data-testid="plan-search"
      />
    </label>
    <p class="text-2xs text-fg-subtle">{{ t(isMobile ? 'plan.hintTap' : 'plan.hintDrag') }}</p>
    <div class="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto" data-test="undated">
      <!-- карточка: статус и название, ниже ключ, статус, приоритет, исполнители -->
      <button
        v-for="x in found.slice(0, LIMIT)"
        :key="x.id"
        type="button"
        :draggable="!isMobile"
        class="flex w-full flex-col gap-1 rounded-md border border-border bg-bg px-2 py-1.5 text-left text-sm hover:border-border-strong"
        :data-task="x.id"
        data-testid="plan-task"
        @dragstart="dragStart($event, x.id)"
        @click="choose(x)"
      >
        <span class="flex min-w-0 items-center gap-1.5">
          <StatusIcon v-if="statusOf(x.statusId)" :status="statusOf(x.statusId)!" />
          <span class="truncate">{{ x.title }}</span>
        </span>
        <span class="flex w-full items-center gap-2 text-xs text-fg-muted">
          <span class="font-mono">{{ x.key }}</span>
          <span v-if="statusOf(x.statusId)" class="truncate">{{ statusOf(x.statusId)!.name }}</span>
          <PriorityIcon v-if="x.priority" :priority="x.priority" :size="14" />
          <AvatarStack
            v-if="x.assigneeIds.length"
            class="ml-auto"
            :people="peopleOf(x.assigneeIds)"
            size="xs"
          />
        </span>
      </button>
      <p v-if="found.length > LIMIT" class="px-2 py-1 text-xs text-fg-subtle">
        {{ t('plan.more', { n: found.length - LIMIT }) }}
      </p>
    </div>
  </aside>
</template>
