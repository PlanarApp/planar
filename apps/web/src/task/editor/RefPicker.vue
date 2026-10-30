<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { FileText, SquareCheck } from 'lucide-vue-next';
import { useSearch } from '../../command/search';
import { useExtensions } from '../../modules/registry';
import type { SearchHit } from '../../modules/types';

// @@ — ссылка на задачу, @@@ (третий @ в поле поиска) — на документ; поиск по реплике, как палитра
export interface RefPick {
  label: string;
  href: string;
}
const props = defineProps<{ rect: { left: number; top: number; bottom: number } }>();
const emit = defineEmits<{ pick: [RefPick]; close: [] }>();
const { t } = useI18n();
const tab = ref<'tasks' | 'docs'>('tasks');
const q = ref('');
const index = ref(0);
const input = ref<HTMLInputElement | null>(null);
const tasks = useSearch();
// документы — провайдер модуля docs (если модуль включён); без импорта модуля в ядро
const providers = useExtensions('search');
const docsProvider = computed(() => providers.value.find((p) => p.moduleId === 'docs'));
const docs = ref<SearchHit[]>([]);
let seq = 0;
watch([q, tab, docsProvider], async () => {
  if (tab.value !== 'docs' || !docsProvider.value) return;
  const n = ++seq;
  const r = q.value.trim() ? await docsProvider.value.search(q.value, 20) : [];
  if (n === seq) docs.value = r;
});
const rows = computed<(RefPick & { id: string; sub?: string })[]>(() =>
  tab.value === 'tasks'
    ? tasks
        .search(q.value)
        .slice(0, 20)
        .map((h) => ({
          id: h.id,
          label: `${h.ref} ${h.title}`,
          href: `/t/${h.ref}`,
          sub: h.ref,
        }))
    : docs.value.map((h) => ({
        id: h.id,
        label: h.title,
        href: typeof h.to === 'string' ? h.to : '',
        sub: h.subtitle,
      })),
);
watch(rows, () => (index.value = 0));
function onInput(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  // @@@: третий @, набранный сразу, — переключить на документы
  if (v === '@') {
    tab.value = 'docs';
    q.value = '';
    (e.target as HTMLInputElement).value = '';
    return;
  }
  q.value = v;
}
function onKey(e: KeyboardEvent) {
  const n = rows.value.length;
  if (e.key === 'Escape') emit('close');
  else if (e.key === 'ArrowDown' && n) index.value = (index.value + 1) % n;
  else if (e.key === 'ArrowUp' && n) index.value = (index.value + n - 1) % n;
  else if (e.key === 'Enter' && rows.value[index.value]) pick(rows.value[index.value]!);
  else if (e.key === 'Tab') tab.value = tab.value === 'tasks' ? 'docs' : 'tasks';
  else return;
  e.preventDefault();
  e.stopPropagation();
}
const pick = (r: RefPick) => r.href && emit('pick', { label: r.label, href: r.href });
onMounted(() => nextTick(() => input.value?.focus()));
// как список @: снизу нет места — над курсором
const style = computed(() => {
  const r = props.rect;
  return r.bottom + 4 + 320 > window.innerHeight
    ? { left: r.left + 'px', bottom: window.innerHeight - r.top + 4 + 'px' }
    : { left: r.left + 'px', top: r.bottom + 4 + 'px' };
});
const tabs = computed(() => [
  { id: 'tasks' as const, label: t('task.refTasks') },
  ...(docsProvider.value ? [{ id: 'docs' as const, label: t('task.refDocs') }] : []),
]);
</script>

<template>
  <div
    role="dialog"
    :aria-label="t('task.refTitle')"
    data-testid="ref-picker"
    class="fixed z-50 flex w-80 flex-col gap-1 rounded-lg border border-border bg-surface p-2 shadow-md"
    :style="style"
    @focusout="!$el.contains($event.relatedTarget) && emit('close')"
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
    <input
      ref="input"
      :value="q"
      :placeholder="t('task.refSearch')"
      :aria-label="t('task.refSearch')"
      data-testid="ref-search"
      class="h-8 rounded-md border border-border-strong bg-bg px-2 text-sm outline-none focus-visible:ring-2 ring-focus"
      @input="onInput"
      @keydown="onKey"
    />
    <ul role="listbox" class="max-h-64 overflow-y-auto">
      <li
        v-for="(r, i) in rows"
        :key="r.id"
        role="option"
        :aria-selected="i === index"
        data-testid="ref-option"
        :class="[
          'flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2 text-sm',
          i === index && 'bg-bg-muted',
        ]"
        @mousedown.prevent="pick(r)"
      >
        <component
          :is="tab === 'tasks' ? SquareCheck : FileText"
          :size="14"
          class="shrink-0 text-fg-subtle"
        />
        <span class="min-w-0 flex-1 truncate">{{ r.label }}</span>
      </li>
      <li v-if="!rows.length" class="px-2 py-1 text-xs text-fg-subtle">
        {{ q.trim() ? t('task.refNone') : t('task.refHint') }}
      </li>
    </ul>
  </div>
</template>
