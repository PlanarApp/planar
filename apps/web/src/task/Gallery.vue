<script setup lang="ts">
// PLNRAPP-372: photos of a comment — full screen, flip through, zoom (buttons, wheel, double click, pinch), download
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from 'lucide-vue-next';
import type { Row } from '@planar/shared';
import { downloadUrl, fileUrl } from './commentFiles';

const props = defineProps<{ items: Row<'attachments'>[] }>();
/** the open photo; null — closed */
const index = defineModel<number | null>('index', { default: null });
const { t } = useI18n();

const MIN = 1;
const MAX = 8;
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
const failed = ref(false);
const cur = computed(() => (index.value === null ? undefined : props.items[index.value]));
const open = computed({
  get: () => !!cur.value,
  set: (v) => !v && (index.value = null),
});
const reset = () => {
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
};
watch(index, () => {
  reset();
  failed.value = false;
});
const n = computed(() => props.items.length);
const go = (d: number) => {
  if (index.value === null || n.value < 2) return;
  index.value = (index.value + d + n.value) % n.value;
};
const setZoom = (z: number) => {
  zoom.value = Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));
  if (zoom.value === 1) pan.value = { x: 0, y: 0 };
};
function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'ArrowRight') go(1);
  else if (e.key === '+' || e.key === '=') setZoom(zoom.value * 1.5);
  else if (e.key === '-') setZoom(zoom.value / 1.5);
  else if (e.key === '0') reset();
  else return;
  e.preventDefault();
}
const onWheel = (e: WheelEvent) => setZoom(zoom.value * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
const onDbl = () => (zoom.value > 1 ? reset() : setZoom(2.5));

// pointers: one — pan of a zoomed photo or a swipe to flip; two — pinch
const pts = new Map<number, { x: number; y: number }>();
let start: { x: number; y: number; px: number; py: number; dist: number; zoom: number } | null =
  null;
const dist = () => {
  const [a, b] = [...pts.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
};
function down(e: PointerEvent) {
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  start = {
    x: e.clientX,
    y: e.clientY,
    px: pan.value.x,
    py: pan.value.y,
    dist: dist(),
    zoom: zoom.value,
  };
}
function move(e: PointerEvent) {
  if (!pts.has(e.pointerId) || !start) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 2 && start.dist) setZoom((start.zoom * dist()) / start.dist);
  else if (pts.size === 1 && zoom.value > 1)
    pan.value = { x: start.px + e.clientX - start.x, y: start.py + e.clientY - start.y };
}
function up(e: PointerEvent) {
  const was = pts.size;
  pts.delete(e.pointerId);
  if (was === 1 && start && zoom.value === 1) {
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - start.y)) go(dx < 0 ? 1 : -1);
  }
  start = pts.size
    ? { ...start!, dist: dist(), zoom: zoom.value, px: pan.value.x, py: pan.value.y }
    : null;
}
const btn =
  'inline-flex size-10 items-center justify-center rounded-md text-white/90 outline-none hover:bg-white/15 focus-visible:ring-2 ring-focus disabled:opacity-40';
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/90" />
      <DialogContent
        v-if="cur"
        class="fixed inset-0 z-50 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-white outline-none"
        data-testid="gallery"
        @keydown="onKey"
      >
        <div class="flex items-center gap-1 px-2 py-1">
          <DialogTitle class="min-w-0 flex-1 truncate text-sm font-medium">{{
            cur.name
          }}</DialogTitle>
          <DialogDescription class="shrink-0 text-xs text-white/70" data-testid="gallery-count">
            {{ (index ?? 0) + 1 }} / {{ items.length }}
          </DialogDescription>
          <button
            type="button"
            :class="btn"
            :aria-label="t('task.zoomOut')"
            :disabled="zoom <= MIN"
            data-testid="gallery-zoom-out"
            @click="setZoom(zoom / 1.5)"
          >
            <ZoomOut :size="18" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="hidden min-w-12 text-xs text-white/80 sm:inline"
            :aria-label="t('task.zoomReset')"
            data-testid="gallery-zoom"
            @click="reset"
          >
            {{ Math.round(zoom * 100) }}%
          </button>
          <button
            type="button"
            :class="btn"
            :aria-label="t('task.zoomIn')"
            :disabled="zoom >= MAX"
            data-testid="gallery-zoom-in"
            @click="setZoom(zoom * 1.5)"
          >
            <ZoomIn :size="18" aria-hidden="true" />
          </button>
          <a
            :href="downloadUrl(cur)"
            :class="btn"
            :aria-label="t('task.download')"
            :title="t('task.download')"
            download
            data-testid="gallery-download"
          >
            <Download :size="18" aria-hidden="true" />
          </a>
          <DialogClose :class="btn" :aria-label="t('ui.close')" data-testid="gallery-close">
            <X :size="20" aria-hidden="true" />
          </DialogClose>
        </div>
        <div
          class="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden select-none"
          @wheel.prevent="onWheel"
          @dblclick="onDbl"
          @pointerdown="down"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
        >
          <p v-if="failed" class="text-sm text-white/80" data-testid="gallery-failed">
            {{ t('task.cantShow') }}
          </p>
          <img
            v-else
            :key="cur.id"
            :src="fileUrl(cur)"
            :alt="cur.name"
            draggable="false"
            class="max-h-full max-w-full object-contain"
            :class="zoom > 1 ? 'cursor-grab' : 'cursor-zoom-in'"
            :style="{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }"
            data-testid="gallery-image"
            @error="failed = true"
          />
          <template v-if="items.length > 1">
            <button
              type="button"
              :class="[btn, 'absolute left-2 bg-black/40']"
              :aria-label="t('task.galleryPrev')"
              data-testid="gallery-prev"
              @pointerdown.stop
              @click="go(-1)"
            >
              <ChevronLeft :size="22" aria-hidden="true" />
            </button>
            <button
              type="button"
              :class="[btn, 'absolute right-2 bg-black/40']"
              :aria-label="t('task.galleryNext')"
              data-testid="gallery-next"
              @pointerdown.stop
              @click="go(1)"
            >
              <ChevronRight :size="22" aria-hidden="true" />
            </button>
          </template>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
