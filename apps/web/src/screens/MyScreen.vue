<script setup lang="ts">
import { computed } from 'vue';
import { ListChecks } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { StatusIcon } from '../tasks';
import { EmptyState } from '../ui';
import { openTask } from '../views';
import { formatDue } from '../views/list/due';
import { useAuth } from '../auth/useAuth';
import { useMyTasks, type MyTask } from '../inbox/queries';

const { t, locale } = useI18n();
// projectIds — вид «Мои задачи» группы (только её проекты, без заголовка экрана)
const props = defineProps<{ projectIds?: string[] }>();
const { user } = useAuth();
const all = useMyTasks(() => user.value?.id);
const rows = computed(() => {
  const ids = props.projectIds && new Set(props.projectIds);
  return ids ? all.value?.filter((r) => ids.has(r.projectId)) : all.value;
});

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const groups = computed(() => {
  const now = new Date();
  const today = iso(now);
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  const week = iso(sunday);
  const order = ['overdue', 'today', 'week', 'later', 'none'];
  const g: Record<string, MyTask[]> = Object.fromEntries(order.map((k) => [k, []]));
  for (const r of rows.value ?? []) {
    const d = r.dueDate;
    g[
      !d ? 'none' : d < today ? 'overdue' : d === today ? 'today' : d <= week ? 'week' : 'later'
    ].push(r);
  }
  for (const k of order) g[k].sort((a, b) => ((a.dueDate ?? '') < (b.dueDate ?? '') ? -1 : 1));
  return order.filter((k) => g[k].length).map((k) => ({ k, items: g[k] }));
});
</script>

<template>
  <div class="flex flex-col gap-3 p-4">
    <h1 v-if="!projectIds" class="text-xl font-semibold">{{ t('screens.my') }}</h1>
    <EmptyState
      v-if="rows && !rows.length"
      :icon="ListChecks"
      :title="t('inbox.myEmpty')"
      :description="t('inbox.myEmptyHint')"
    />
    <section v-for="g in groups" :key="g.k" :data-group="g.k">
      <h2 class="mb-1 text-xs font-medium text-fg-muted">{{ t(`inbox.my.${g.k}`) }}</h2>
      <button
        v-for="r in g.items"
        :key="r.id"
        type="button"
        data-testid="my-row"
        class="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus"
        @click="openTask(r.key)"
      >
        <StatusIcon :status="r.status" />
        <span class="text-xs text-fg-subtle">{{ r.key }}</span>
        <span class="flex-1 truncate">{{ r.title }}</span>
        <span v-if="r.dueDate" class="text-xs text-fg-muted">{{
          formatDue(r.dueDate, locale)
        }}</span>
        <span class="hidden text-xs text-fg-subtle md:inline">{{ r.project }}</span>
      </button>
    </section>
  </div>
</template>
