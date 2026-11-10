<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Download } from 'lucide-vue-next';
import { Button, Input, Popover } from '@planar/web/modules';
import { exportRows, toCsv } from './lib';
import { isInstanceAdmin, loadExport, tr, userId, useUsers, type Key } from './data';

// CSV of time entries (PLNRAPP-149): admins — for the chosen people, everyone else — own entries
const props = defineProps<{ from: string; to: string; inScope?: (taskId: string) => boolean }>();
const admin = computed(isInstanceAdmin);
const users = useUsers();
const open = ref(false);
const from = ref(props.from);
const to = ref(props.to);
const picked = ref<string[]>([userId()]);
const err = ref('');
// the period follows the shown week until the dialog is opened
watch(open, (o) => {
  if (!o) return;
  from.value = props.from;
  to.value = props.to;
  err.value = '';
});

async function download() {
  const ids = admin.value ? picked.value : [userId()];
  const rows = exportRows(await loadExport(ids), from.value, to.value, props.inScope);
  if (!rows.length) return void (err.value = tr('nothing'));
  const head: Key[] = [
    'colDate',
    'colProject',
    'colTask',
    'colUser',
    'colLogin',
    'colMin',
    'colNote',
    'colBilled',
  ];
  const blob = new Blob([toCsv([head.map(tr), ...rows])], {
    type: 'text/csv;charset=utf-8',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `time-${from.value}_${to.value}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  open.value = false;
}
</script>

<template>
  <Popover v-model:open="open" align="end">
    <template #trigger>
      <Button size="sm" data-test="export">
        <Download :size="14" aria-hidden="true" /> {{ tr('export') }}
      </Button>
    </template>
    <form class="ex" @submit.prevent="download">
      <div class="row">
        <Input v-model="from" type="date" :label="tr('from')" data-test="export-from" />
        <Input v-model="to" type="date" :label="tr('to')" data-test="export-to" />
      </div>
      <fieldset v-if="admin" class="people">
        <legend>{{ tr('people') }}</legend>
        <label v-for="u in users ?? []" :key="u.id" class="check">
          <input v-model="picked" type="checkbox" :value="u.id" data-test="export-user" />
          {{ u.name }}
        </label>
      </fieldset>
      <p v-if="err" class="err" role="alert">{{ err }}</p>
      <Button
        type="submit"
        variant="primary"
        :disabled="!from || !to || (admin && !picked.length)"
        data-test="export-go"
      >
        {{ tr('download') }}
      </Button>
    </form>
  </Popover>
</template>

<style scoped>
.ex {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 18rem;
  max-width: calc(100vw - 2rem);
  font-size: var(--text-sm);
}
.row {
  display: flex;
  gap: 8px;
}
.people {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 14rem;
  overflow-y: auto;
  border: 0;
  margin: 0;
  padding: 0;
}
legend {
  color: var(--color-fg-muted);
  font-size: var(--text-xs);
  margin-bottom: 4px;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
}
.err {
  color: var(--color-danger);
}
</style>
