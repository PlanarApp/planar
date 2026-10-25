<script setup lang="ts">
import { useSelection } from '../selection';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { observeElementRect, useVirtualizer } from '@tanstack/vue-virtual';
import type { Rect, Virtualizer } from '@tanstack/vue-virtual';
import { VueDraggable } from 'vue-draggable-plus';
import { ChevronsLeft, Plus } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import type { TaskGroup, TaskView } from '../../tasks';
import { PriorityIcon } from '../../tasks';
import { BlockedIcon } from '../../links';
import { AvatarStack, Badge, Button, Input } from '../../ui';
import type { TaskField } from '../options';
import { formatDue } from '../list/due';

const VIRTUAL_FROM = 50;
const CARD = 84; // оценка высоты карточки с зазором, px; реальная — по содержимому (measureElement)

const props = defineProps<{
  group: TaskGroup;
  members: Row<'users'>[];
  labels: Row<'labels'>[];
  collapsed: boolean;
  mobile: boolean;
  fields: TaskField[];
  blocked: ReadonlySet<string>;
  /** id задачи → название, для подписи родителя у подзадачи */
  titles?: ReadonlyMap<string, string>;
}>();
const emit = defineEmits<{
  toggle: [];
  open: [key: string];
  add: [title: string];
  move: [id: string, from: string, to: string, beforeId: string | null];
}>();
const { t, locale } = useI18n();
// Ctrl/Cmd — добавить к выделению, Shift — диапазон в колонке; обычный клик открывает задачу
const sel = useSelection();
function onCard(x: TaskView, e: MouseEvent) {
  if (e.metaKey || e.ctrlKey) sel.toggle(x.id);
  else if (e.shiftKey)
    sel.range(
      props.group.tasks.map((y) => y.id),
      x.id,
    );
  else emit('open', x.key);
}

const scroller = useTemplateRef<HTMLElement>('scroller');
const virtual = computed(() => props.group.tasks.length > VIRTUAL_FROM);
const virt = useVirtualizer(
  computed(() => ({
    count: virtual.value ? props.group.tasks.length : 0,
    getScrollElement: () => scroller.value,
    estimateSize: () => CARD,
    overscan: 6,
    // нулевая высота (первый кадр, happy-dom) — берём 600px, иначе не отрисуется ничего
    initialRect: { width: 280, height: 600 },
    observeElementRect: (i: Virtualizer<HTMLElement, Element>, cb: (r: Rect) => void) =>
      observeElementRect(i, (r) => cb(r.height ? r : { ...r, height: 600 })),
  })),
);
const rows = computed(() => {
  if (!virtual.value) return { items: props.group.tasks, first: 0, top: 0, bottom: 0 };
  const v = virt.value.getVirtualItems();
  return {
    items: v.map((x) => props.group.tasks[x.index]),
    first: v[0]?.index ?? 0,
    top: v[0]?.start ?? 0,
    bottom: v.length ? virt.value.getTotalSize() - v[v.length - 1].end : 0,
  };
});

const name = (id: string) => props.members.find((u) => u.id === id)?.name ?? '?';
const label = (id: string) => props.labels.find((l) => l.id === id);

let anchor: ChildNode | null = null;
const onStart = (e: { item: HTMLElement }) => {
  anchor = e.item.nextSibling;
};
const dataId = (n: Element | null) => n?.getAttribute('data-id') ?? null;
const nextCard = (el: Element | null) => {
  while (el && !el.hasAttribute('data-id')) el = el.nextElementSibling;
  return el;
};
/** DOM Sortable переставляет сам; данные — из реплики, поэтому возвращаем DOM на место. */
function onEnd(e: {
  item: HTMLElement;
  from: HTMLElement;
  to: HTMLElement;
  oldDraggableIndex?: number;
  newDraggableIndex?: number;
}) {
  const id = dataId(e.item)!;
  const from = e.from.dataset.col!;
  // внутри колонки vue-draggable-plus уже вернул DOM на место (ждёт update:modelValue) — позиция из индексов
  if (from === e.to.dataset.col) {
    const o = e.oldDraggableIndex,
      n = e.newDraggableIndex;
    if (o === undefined || n === undefined || o === n) return; // бросили на то же место
    const rest = rows.value.items.filter((x) => x.id !== id);
    return emit('move', id, from, from, rest[n]?.id ?? null);
  }
  const beforeId = dataId(nextCard(e.item.nextElementSibling));
  e.item.remove();
  e.from.insertBefore(e.item, anchor);
  emit('move', id, from, e.to.dataset.col!, beforeId);
}

const adding = ref(false);
const form = useTemplateRef<HTMLFormElement>('form');
async function startAdd() {
  adding.value = true;
  await nextTick();
  form.value?.querySelector('input')?.focus();
}
const title = ref('');
function submit() {
  const v = title.value.trim();
  if (v) emit('add', v);
  title.value = '';
  adding.value = false;
}
const hasFoot = (x: TaskView) =>
  (props.fields.includes('labels') && x.labelIds.some((l) => label(l))) ||
  (props.fields.includes('dueDate') && !!x.dueDate) ||
  (props.fields.includes('assignee') && x.assigneeIds.length > 0);
</script>

<template>
  <button
    v-if="collapsed"
    type="button"
    class="flex h-full w-10 shrink-0 flex-col items-center gap-2 rounded-md bg-bg-subtle py-2 text-sm text-fg-muted focus-visible:ring-2 ring-focus"
    :aria-label="`${group.label}: ${t('board.expand')}`"
    @click="emit('toggle')"
  >
    <span class="text-xs">{{ group.tasks.length }}</span>
    <span class="[writing-mode:vertical-rl] font-medium text-fg">{{ group.label }}</span>
  </button>
  <section
    v-else
    class="flex h-full shrink-0 snap-start flex-col rounded-md bg-bg-subtle"
    :class="mobile ? 'w-[85vw]' : 'w-[280px]'"
    :aria-label="group.label"
  >
    <header class="flex items-center gap-2 px-3 py-2 text-sm">
      <span
        v-if="group.color"
        class="size-2 rounded-full"
        :style="{ background: group.color }"
        aria-hidden="true"
      />
      <h3 class="truncate font-medium text-fg">{{ group.label }}</h3>
      <span class="text-fg-muted">{{ group.tasks.length }}</span>
      <button
        type="button"
        class="ml-auto rounded-sm p-1 text-fg-subtle hover:bg-bg-muted focus-visible:ring-2 ring-focus"
        :aria-label="t('board.collapse')"
        data-testid="collapse"
        @click="emit('toggle')"
      >
        <ChevronsLeft :size="14" aria-hidden="true" />
      </button>
    </header>
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto px-2">
      <VueDraggable
        :model-value="rows.items"
        :data-col="group.key"
        group="board"
        :animation="150"
        draggable="[data-id]"
        class="min-h-8"
        :style="{ paddingTop: rows.top + 'px', paddingBottom: rows.bottom + 'px' }"
        :force-fallback="false"
        @start="onStart"
        @end="onEnd"
      >
        <article
          v-for="(x, n) in rows.items"
          :key="x.id"
          :ref="(el) => virtual && virt.measureElement(el as Element | null)"
          :data-index="rows.first + n"
          :data-id="x.id"
          :data-task="x.key"
          tabindex="0"
          :class="[
            'mb-2 flex cursor-grab flex-col gap-1 rounded-lg border bg-surface p-2 focus-visible:ring-2 ring-focus',
            sel.selected.value.has(x.id) ? 'border-accent bg-accent-subtle' : 'border-border',
          ]"
          @click="onCard(x, $event)"
          @keydown.enter.self="emit('open', x.key)"
        >
          <span
            v-if="x.parentId && titles?.get(x.parentId)"
            class="truncate text-xs text-fg-subtle"
            data-testid="card-parent"
            >↳ {{ titles.get(x.parentId) }}</span
          >
          <div class="flex items-start gap-1.5">
            <PriorityIcon
              v-if="fields.includes('priority') && x.priority"
              :priority="x.priority"
              class="mt-0.5"
            />
            <span class="mt-0.5 shrink-0 font-mono text-xs text-fg-muted">{{ x.key }}</span>
            <BlockedIcon v-if="blocked.has(x.id)" />
            <p class="line-clamp-3 min-w-0 flex-1 text-sm leading-snug text-fg">{{ x.title }}</p>
          </div>
          <div v-if="hasFoot(x)" class="flex items-center gap-2 overflow-hidden">
            <template v-for="l in fields.includes('labels') ? x.labelIds : []" :key="l">
              <Badge v-if="label(l)" dot :color="label(l)!.color ?? undefined">{{
                label(l)!.name
              }}</Badge>
            </template>
            <span v-if="x.dueDate && fields.includes('dueDate')" class="text-xs text-fg-muted">{{
              formatDue(x.dueDate, locale)
            }}</span>
            <AvatarStack
              v-if="fields.includes('assignee')"
              class="ml-auto shrink-0"
              :people="x.assigneeIds.map((a) => ({ name: name(a) }))"
              size="xs"
            />
          </div>
        </article>
      </VueDraggable>
    </div>
    <footer class="px-2 py-2">
      <form
        v-if="adding"
        ref="form"
        @submit.prevent="submit"
        @keydown.esc="adding = false"
        @focusout="submit"
      >
        <Input v-model="title" :label="t('board.newTitle')" hide-label />
      </form>
      <Button v-else variant="ghost" class="w-full" :icon="Plus" @click="startAdd">
        {{ t('board.add') }}
      </Button>
    </footer>
  </section>
</template>
