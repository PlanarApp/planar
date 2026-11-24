<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSearch } from '../../command/search';
import { DocPicker, TaskPicker, useDocsPickable } from '../../pickers';

// @@ — link to a task, @@@ (third @ in the search field) — to a document; the common task and document
// pickers (PLNRAPP-827), tasks are searched over the replica like the palette
export interface RefPick {
  label: string;
  href: string;
}
const props = defineProps<{ rect: { left: number; top: number; bottom: number } }>();
const emit = defineEmits<{ pick: [RefPick]; close: [] }>();
const { t } = useI18n();
const tab = ref<'tasks' | 'docs'>('tasks');
const q = ref('');
const index = useSearch();
const docsOn = useDocsPickable();
const tasks = computed(() =>
  index
    .search(q.value)
    .slice(0, 20)
    .map((h) => ({ id: h.id, key: h.ref, title: h.title, path: h.path })),
);
// @@@: a third @ typed at once — switch to documents
watch(q, (v) => {
  if (v === '@' && tab.value === 'tasks' && docsOn.value) {
    tab.value = 'docs';
    q.value = '';
  }
});
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
  else if (e.key === 'Tab' && docsOn.value) tab.value = tab.value === 'tasks' ? 'docs' : 'tasks';
  else return;
  e.preventDefault();
  e.stopPropagation();
}
const pick = (r: RefPick) => r.href && emit('pick', r);
// Switching the tab replaces the focused search field: focusout comes with relatedTarget=null and the new
// picker takes the focus only after mount. So the focus leaving is checked a tick later — the dialog closes
// only when the focus is really outside it.
const root = ref<HTMLElement | null>(null);
function onFocusOut(e: FocusEvent) {
  if (root.value?.contains(e.relatedTarget as Node | null)) return;
  setTimeout(() => {
    if (root.value && !root.value.contains(document.activeElement)) emit('close');
  });
}
// like the @ list: no room below — above the cursor
const style = computed(() => {
  const r = props.rect;
  // keep the (up to 24rem) list inside the screen
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 392)) + 'px';
  return r.bottom + 4 + 320 > window.innerHeight
    ? { left, bottom: window.innerHeight - r.top + 4 + 'px' }
    : { left, top: r.bottom + 4 + 'px' };
});
const tabs = computed(() => [
  { id: 'tasks' as const, label: t('task.refTasks') },
  ...(docsOn.value ? [{ id: 'docs' as const, label: t('task.refDocs') }] : []),
]);
</script>

<template>
  <div
    ref="root"
    role="dialog"
    :aria-label="t('task.refTitle')"
    data-testid="ref-picker"
    class="fixed z-50 flex w-96 max-w-[calc(100vw-1rem)] flex-col gap-1 rounded-lg border border-border bg-surface p-2 shadow-md"
    :style="style"
    @focusout="onFocusOut"
  >
    <div class="flex gap-1">
      <button
        v-for="x in tabs"
        :key="x.id"
        type="button"
        :aria-pressed="tab === x.id"
        :data-testid="`ref-tab-${x.id}`"
        :class="[
          'rounded px-2 py-0.5 text-xs outline-none focus-visible:ring-2 ring-focus',
          tab === x.id ? 'bg-bg-muted font-medium text-fg' : 'text-fg-muted hover:text-fg',
        ]"
        @mousedown.prevent="tab = x.id"
      >
        {{ x.label }}
      </button>
    </div>
    <TaskPicker
      v-if="tab === 'tasks'"
      v-model:query="q"
      :tasks="tasks"
      :label="t('task.refSearch')"
      :hint="t('task.refHint')"
      autofocus
      input-testid="ref-search"
      option-testid="ref-option"
      @pick="(x) => pick({ label: `${x.key} ${x.title}`, href: `/t/${x.key}` })"
      @key="onKey"
    />
    <DocPicker
      v-else
      v-model:query="q"
      :label="t('task.refSearch')"
      :hint="t('task.refHint')"
      autofocus
      input-testid="ref-search"
      option-testid="ref-option"
      @pick="(h) => pick({ label: h.title, href: typeof h.to === 'string' ? h.to : '' })"
      @key="onKey"
    />
  </div>
</template>
