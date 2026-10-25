<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
import { closeTask, taskPanelLoader } from '../views';
import { taskOpenMode } from '../views/open';
import { useRoute } from 'vue-router';
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { useI18n } from 'vue-i18n';
import { useBreakpoint } from '../ui/useBreakpoint';
import BottomNav from './BottomNav.vue';
import Sidebar from './Sidebar.vue';
import TopBar from './TopBar.vue';
import { mobileNav } from './nav';

const { isMobile } = useBreakpoint();
const { t } = useI18n();
const route = useRoute();
// переход по ссылке закрывает панель; клик по ссылке на текущий маршрут route не меняет — ловим клик
const closeOnLink = (e: MouseEvent) => {
  if ((e.target as Element).closest('a[href]')) mobileNav.value = false;
};
watch(
  () => route.fullPath,
  () => (mobileNav.value = false),
);

// «Открывать как: боковая панель» — правая часть сплита под верхней панелью, как в ClickUp: экран слева
// сохраняет прежнюю ширину и прокручивается вбок, а не сжимается
const TaskPanel = taskPanelLoader && defineAsyncComponent(taskPanelLoader);
const GROUP_ROUTES = ['project', 'space', 'workspace'];
const sideKey = computed(() =>
  TaskPanel &&
  !isMobile.value &&
  taskOpenMode.value === 'side' &&
  GROUP_ROUTES.includes(String(route.name)) &&
  typeof route.query.task === 'string'
    ? route.query.task
    : '',
);
const main = ref<HTMLElement>();
const fullW = ref(0);
let ro: ResizeObserver | undefined;
watch(main, (el) => {
  ro?.disconnect();
  if (!el || typeof ResizeObserver === 'undefined') return;
  // ширина экрана без панели — её и держит содержимое, пока панель открыта
  ro = new ResizeObserver(() => {
    if (!sideKey.value) fullW.value = el.clientWidth;
  });
  ro.observe(el);
});
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div class="flex h-full bg-bg text-fg">
    <Sidebar v-if="!isMobile" />
    <DialogRoot v-if="isMobile" v-model:open="mobileNav">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
        <DialogContent
          aria-describedby="undefined"
          class="fixed inset-y-0 left-0 z-50 flex w-70 max-w-full outline-none [&>aside]:w-full"
          @click="closeOnLink"
        >
          <DialogTitle class="sr-only">{{ t('topbar.nav') }}</DialogTitle>
          <Sidebar />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar />
      <div class="flex min-h-0 flex-1">
        <main ref="main" class="min-h-0 min-w-0 flex-1 overflow-auto">
          <div class="h-full" :style="sideKey && fullW ? { minWidth: `${fullW}px` } : undefined">
            <RouterView />
          </div>
        </main>
        <aside
          v-if="sideKey"
          role="dialog"
          :aria-label="sideKey"
          class="flex w-[min(48rem,55%)] shrink-0 overflow-hidden border-l border-border bg-surface"
          data-testid="task-side"
        >
          <component
            :is="TaskPanel"
            :key="sideKey"
            :task-key="sideKey"
            mode="panel"
            @close="closeTask"
          />
        </aside>
      </div>
      <BottomNav v-if="isMobile" />
    </div>
  </div>
</template>
