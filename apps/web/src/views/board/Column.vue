<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { observeElementRect, useVirtualizer } from '@tanstack/vue-virtual';
import type { Rect, Virtualizer } from '@tanstack/vue-virtual';
import { VueDraggable } from 'vue-draggable-plus';
import { ChevronsLeft, Plus } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import type { TaskGroup } from '../../tasks';
import { PriorityIcon } from '../../tasks';
import { BlockedIcon } from '../../links';
import { Avatar, Badge, Button, Input } from '../../ui';
import type { TaskField } from '../options';

const VIRTUAL_FROM = 50;
const CARD = 96; // высота карточки с зазором, px

const props = defineProps<{
  group: TaskGroup;
  members: Row<'users'>[];
  labels: Row<'labels'>[];
  collapsed: boolean;
  mobile: boolean;
  fields: TaskField[];
  blocked: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  toggle: [];
  open: [key: string];
  add: [title: string];
  move: [id: string, from: string, to: string, beforeId: string | null];
}>();
const { t } = useI18n();

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
  if (!virtual.value) return { items: props.group.tasks, top: 0, bottom: 0 };
  const v = virt.value.getVirtualItems();
  return {
    items: v.map((x) => props.group.tasks[x.index]),
    top: v[0]?.start ?? 0,
    bottom: v.length ? virt.value.getTotalSize() - v[v.length - 1].end : 0,
  };
});

const name = (id: string) => props.members.find((u) => u.id === id)?.name ?? '?';
const label = (id: string) => props.labels.find((l) => l.id === id);

let anchor: ChildNode | null = null;
let startBefore: string | null = null;
const onStart = (e: { item: HTMLElement }) => {
  anchor = e.item.nextSibling;
  startBefore = dataId(nextCard(e.item.nextElementSibling));
};
const dataId = (n: Element | null) => n?.getAttribute('data-id') ?? null;
const nextCard = (el: Element | null) => {
  while (el && !el.hasAttribute('data-id')) el = el.nextElementSibling;
  return el;
};
/** DOM Sortable переставляет сам; данные — из реплики, поэтому возвращаем DOM на место. */
function onEnd(e: { item: HTMLElement; from: HTMLElement; to: HTMLElement }) {
  const beforeId = dataId(nextCard(e.item.nextElementSibling));
  const id = dataId(e.item)!;
  e.item.remove();
  e.from.insertBefore(e.item, anchor);
  const from = e.from.dataset.col!;
  if (from === e.to.dataset.col && beforeId === startBefore) return; // бросили на то же место
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
function due(d: string) {
  return d.slice(5).replace('-', '.');
}
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
          v-for="x in rows.items"
          :key="x.id"
          :data-id="x.id"
          tabindex="0"
          class="mb-2 flex h-[88px] cursor-grab flex-col gap-1 overflow-hidden rounded-md border border-border bg-surface p-2 text-sm focus-visible:ring-2 ring-focus"
          @click="emit('open', x.key)"
          @keydown.enter.self="emit('open', x.key)"
        >
          <div class="flex items-center gap-1.5 text-xs text-fg-muted">
            <PriorityIcon v-if="fields.includes('priority')" :priority="x.priority" />
            <span>{{ x.key }}</span>
            <BlockedIcon v-if="blocked.has(x.id)" />
            <span v-if="x.dueDate && fields.includes('dueDate')" class="ml-auto">{{
              due(x.dueDate)
            }}</span>
          </div>
          <p class="line-clamp-2 text-fg">{{ x.title }}</p>
          <div class="mt-auto flex items-center gap-1 overflow-hidden">
            <template v-for="l in fields.includes('labels') ? x.labelIds : []" :key="l">
              <Badge v-if="label(l)" :color="label(l)!.color ?? undefined">{{
                label(l)!.name
              }}</Badge>
            </template>
            <span v-if="fields.includes('assignee')" class="ml-auto flex shrink-0 -space-x-1">
              <Avatar v-for="a in x.assigneeIds.slice(0, 3)" :key="a" :name="name(a)" size="xs" />
            </span>
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
