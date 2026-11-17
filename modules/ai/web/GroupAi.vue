<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GroupScope } from '@planar/web/modules';
import type { AiUsage, AiUsageReport } from '../shared/index.js';
import { call } from './api';
import { dayStr, fmtCost, fmtDuration, reportRange } from './aiUi';
import { tr } from './data';

// «Reports › AI» tab of the group: the cost of the finished runs of its level and nested ones (PLNRAPP-403)
const props = defineProps<{ scope: GroupScope }>();
const monthAgo = new Date();
monthAgo.setDate(monthAgo.getDate() - 29);
const from = ref(dayStr(monthAgo));
const to = ref(dayStr(new Date()));
const groupBy = ref<'task' | 'day'>('task');
const report = ref<AiUsageReport | null>(null);
const err = ref('');
const range = computed(() => reportRange(from.value, to.value));

let seq = 0;
async function load() {
  const r = range.value;
  if (!r) return;
  const my = ++seq;
  const q = new URLSearchParams({ ...r, groupBy: groupBy.value });
  const s = props.scope;
  if (s.level === 'project' && s.projectId) q.set('projectId', s.projectId);
  else if (s.level === 'space') q.set('spaceId', s.spaceId);
  try {
    const res = await call<AiUsageReport>('GET', `reports/usage?${q}`);
    if (my !== seq) return;
    report.value = res;
    err.value = '';
  } catch (e) {
    if (my === seq) err.value = (e as Error).message;
  }
}
watch([range, groupBy, () => props.scope], load, { immediate: true });

const tokens = (u: AiUsage) => `${u.inputTokens} / ${u.outputTokens}`;
</script>

<template>
  <section class="flex flex-col gap-3 p-4" data-testid="ai-report">
    <div class="flex flex-wrap items-end gap-3 text-sm">
      <label class="flex flex-col gap-1">
        {{ tr('repFrom') }}
        <input v-model="from" type="date" class="rounded border border-border px-2 py-1" />
      </label>
      <label class="flex flex-col gap-1">
        {{ tr('repTo') }}
        <input v-model="to" type="date" class="rounded border border-border px-2 py-1" />
      </label>
      <div class="flex gap-1" role="group">
        <button
          v-for="g in ['task', 'day'] as const"
          :key="g"
          type="button"
          class="rounded border border-border px-2 py-1"
          :class="groupBy === g && 'bg-accent text-white'"
          :aria-pressed="groupBy === g"
          :data-testid="`ai-report-${g}`"
          @click="groupBy = g"
        >
          {{ tr(g === 'task' ? 'repByTask' : 'repByDay') }}
        </button>
      </div>
    </div>
    <p v-if="!range" role="alert" class="text-sm text-danger">{{ tr('repBadPeriod') }}</p>
    <p v-else-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
    <p v-else-if="report && !report.rows.length" class="text-sm text-fg-muted">
      {{ tr('repEmpty') }}
    </p>
    <div v-else-if="report" class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="text-fg-muted">
            <th class="py-1 pr-3">{{ tr(groupBy === 'task' ? 'repTask' : 'repDay') }}</th>
            <th class="py-1 pr-3">{{ tr('repRuns') }}</th>
            <th class="py-1 pr-3">{{ tr('repTime') }}</th>
            <th class="py-1 pr-3">{{ tr('repTokens') }}</th>
            <th class="py-1">{{ tr('repCost') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in report.rows" :key="r.key" class="border-t border-border">
            <td class="py-1 pr-3">{{ r.label }}</td>
            <td class="py-1 pr-3">{{ r.runs }}</td>
            <td class="py-1 pr-3">{{ fmtDuration(r.seconds) }}</td>
            <td class="py-1 pr-3">{{ tokens(r) }}</td>
            <td class="py-1">{{ fmtCost(r.cost) }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="border-t border-border font-medium" data-testid="ai-report-total">
            <td class="py-1 pr-3">{{ tr('repTotal') }}</td>
            <td class="py-1 pr-3">{{ report.total.runs }}</td>
            <td class="py-1 pr-3">{{ fmtDuration(report.total.seconds) }}</td>
            <td class="py-1 pr-3">{{ tokens(report.total) }}</td>
            <td class="py-1">{{ fmtCost(report.total.cost) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>
