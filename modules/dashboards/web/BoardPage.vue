<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { Button, ConfirmDialog, Input, useRouter } from '@planar/web/modules';
import type { Widget, WidgetKind } from '../shared/index.js';
import WidgetBody from './WidgetBody.vue';
import WidgetDialog from './WidgetDialog.vue';
import { boardTasks, moveBox, nextY, resizeBox, type Box } from './lib';
import { mutate, newId, tr, useBoard, useTasks, useWidgets } from './data';

const router = useRouter();
// boardId и back — дашборд внутри таба группы (id из ?board, назад — к списку)
const props = defineProps<{ boardId?: string; back?: () => void }>();
const id = computed(() => props.boardId ?? String(router.currentRoute.value.params.id ?? ''));
const leave = () => (props.back ? props.back() : void router.push('/m/dashboards'));
const board = useBoard(() => id.value);
const widgets = useWidgets(() => id.value);
const allTasks = useTasks();
const tasks = computed(() => boardTasks(board.value?.spaceId ?? '', allTasks.value ?? []));

// предпросмотр перетаскивания: id -> бокс; в реплику пишем по отпусканию
const preview = reactive<Record<string, Box>>({});
const boxOf = (w: Widget): Box => preview[w.id] ?? w;
const style = (w: Widget) => {
  const b = boxOf(w);
  return { gridColumn: `${b.x + 1} / span ${b.w}`, gridRow: `${b.y + 1} / span ${b.h}` };
};

const GAP = 8;
const ROW = 80;
const grid = ref<HTMLElement>();
let drag: { w: Widget; mode: 'move' | 'size'; x: number; y: number } | undefined;

function down(e: PointerEvent, w: Widget, mode: 'move' | 'size') {
  drag = { w, mode, x: e.clientX, y: e.clientY };
  window.addEventListener('pointermove', moveHandler);
  window.addEventListener('pointerup', up, { once: true });
}
const delta = (e: PointerEvent) => {
  const colW = ((grid.value?.clientWidth ?? 12 * 80) + GAP) / 12;
  return [
    Math.round((e.clientX - drag!.x) / colW),
    Math.round((e.clientY - drag!.y) / (ROW + GAP)),
  ];
};
function moveHandler(e: PointerEvent) {
  if (!drag) return;
  const [dx, dy] = delta(e);
  const b = drag.w;
  preview[b.id] = drag.mode === 'move' ? moveBox(b, dx, dy) : resizeBox(b, dx, dy);
}
async function up() {
  window.removeEventListener('pointermove', moveHandler);
  const d = drag;
  drag = undefined;
  if (!d) return;
  const b = preview[d.w.id];
  if (b && (b.x !== d.w.x || b.y !== d.w.y || b.w !== d.w.w || b.h !== d.w.h))
    await mutate('dashboards.widget.update', { id: d.w.id, x: b.x, y: b.y, w: b.w, h: b.h });
  delete preview[d.w.id];
}
onBeforeUnmount(() => window.removeEventListener('pointermove', moveHandler));

const dlg = ref(false);
const editing = ref<Widget>();
const openDialog = (w?: Widget) => {
  editing.value = w;
  dlg.value = true;
};
async function save(v: {
  kind: WidgetKind;
  title: string | null;
  config: Record<string, unknown>;
}) {
  if (editing.value)
    await mutate('dashboards.widget.update', {
      id: editing.value.id,
      title: v.title,
      config: v.config,
    });
  else
    await mutate('dashboards.widget.add', {
      id: newId(),
      dashboardId: id.value,
      kind: v.kind,
      title: v.title,
      config: v.config,
      x: 0,
      y: nextY(widgets.value ?? []),
      w: 4,
      h: 3,
    });
}

const renaming = ref(false);
const name = ref('');
async function rename() {
  renaming.value = false;
  if (name.value.trim() && name.value !== board.value?.name)
    await mutate('dashboards.update', { id: id.value, name: name.value.trim() });
}
const confirmDel = ref(false);
async function delBoard() {
  await mutate('dashboards.delete', { id: id.value });
  leave();
}
</script>

<template>
  <section class="page">
    <p v-if="board === undefined && widgets" class="muted">{{ tr('notFound') }}</p>
    <template v-else-if="board">
      <header class="head">
        <Button variant="ghost" data-test="back" @click="leave()">‹ {{ tr('back') }}</Button>
        <Input
          v-if="renaming"
          v-model="name"
          :label="tr('name')"
          hide-label
          @keydown.enter="rename"
          @blur="rename"
        />
        <h2 v-else data-test="name" @dblclick="((renaming = true), (name = board.name))">
          {{ board.name }}
        </h2>
        <Button data-test="add" @click="openDialog()">{{ tr('addWidget') }}</Button>
        <Button variant="danger-ghost" data-test="del-board" @click="confirmDel = true">{{
          tr('del')
        }}</Button>
      </header>
      <div ref="grid" class="grid" data-test="grid">
        <article
          v-for="w in widgets ?? []"
          :key="w.id"
          class="card"
          :style="style(w)"
          data-test="widget"
        >
          <header
            class="bar"
            :title="tr('move')"
            data-test="handle"
            @pointerdown.prevent="down($event, w, 'move')"
          >
            <span class="t">{{ w.title ?? tr(w.kind) }}</span>
            <button class="ib" data-test="edit" @pointerdown.stop @click="openDialog(w)">✎</button>
            <button
              class="ib"
              data-test="remove"
              @pointerdown.stop
              @click="mutate('dashboards.widget.remove', { id: w.id })"
            >
              ×
            </button>
          </header>
          <div class="body"><WidgetBody :widget="w" :tasks="tasks" /></div>
          <span
            class="size"
            :title="tr('resize')"
            data-test="size"
            @pointerdown.prevent="down($event, w, 'size')"
          />
        </article>
      </div>
      <WidgetDialog v-model:open="dlg" :widget="editing" :space-id="board.spaceId" @save="save" />
      <ConfirmDialog
        v-model:open="confirmDel"
        :title="tr('delBoard')"
        :confirm-label="tr('del')"
        @confirm="delBoard"
      />
    </template>
  </section>
</template>

<style scoped>
.page {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
h2 {
  flex: 1;
  margin: 0;
  font-size: var(--text-xl);
}
.muted {
  color: var(--color-fg-muted);
}
.grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-auto-rows: 80px;
  gap: 8px;
}
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
  cursor: grab;
  touch-action: none;
  font-size: var(--text-sm);
}
.t {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ib {
  all: unset;
  cursor: pointer;
  padding: 0 6px;
  color: var(--color-fg-muted);
}
.ib:hover {
  color: var(--color-fg);
}
.body {
  flex: 1;
  min-height: 0;
  padding: 8px;
  overflow: auto;
}
.size {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  touch-action: none;
  background: linear-gradient(135deg, transparent 50%, var(--color-border-strong) 50%);
}
@media (max-width: 767px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .card {
    grid-column: 1 !important;
    grid-row: auto !important;
    min-height: 240px;
  }
}
</style>
