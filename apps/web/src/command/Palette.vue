<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Dialog, Input } from '../ui';
import { useSelection, openTask } from '../views';
import { useExtensions } from '../modules/registry';
import { buildCommands, type Cmd } from './commands';
import { useSearch, type Hit } from './search';
import { ui } from './hotkeys';

const { t, locale } = useI18n();
const router = useRouter();
const selection = useSelection();
const ext = useExtensions('commands');
const search = useSearch();

const query = ref('');
const active = ref(0);
const cmds = ref<Cmd[]>([]);
const confirming = ref<Cmd | null>(null);

watch(
  () => ui.palette,
  async (open) => {
    if (!open) return;
    query.value = ui.query;
    ui.query = '';
    confirming.value = null;
    cmds.value = await buildCommands({
      t,
      locale: locale.value,
      router,
      selected: [...selection.selected.value],
      ext: ext.value,
    });
  },
  { immediate: true },
);
watch([query, confirming], () => (active.value = 0));

interface Item {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  run: () => void | Promise<void>;
  confirm?: string;
}
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const items = computed<Item[]>(() => {
  if (confirming.value) {
    const c = confirming.value;
    return [{ id: 'ok', label: c.confirm ?? c.label, group: c.label, run: c.run }];
  }
  const ws = norm(query.value).split(/\s+/).filter(Boolean);
  const cs = cmds.value.filter((c) => ws.every((w) => norm(c.label).includes(w)));
  void search.ready.value;
  const hits = ws.length ? search.search(query.value) : [];
  const gT = t('cmd.groupTasks');
  return [
    ...cs,
    ...hits.map((h: Hit) => ({
      id: 'task:' + h.id,
      label: `${h.ref}  ${h.title}`,
      group: gT,
      run: () => openTask(h.ref),
    })),
  ];
});

const run = async (it: Item | undefined) => {
  if (!it) return;
  const c = cmds.value.find((x) => x.id === it.id);
  if (c?.confirm && !confirming.value) {
    confirming.value = c;
    return;
  }
  ui.palette = false;
  await it.run();
};
const onKey = (e: KeyboardEvent) => {
  const n = items.value.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active.value = n ? (active.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n : 0;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    void run(items.value[active.value]);
  }
};
</script>

<template>
  <Dialog v-model:open="ui.palette" :title="t('cmd.title')">
    <div class="flex flex-col gap-2" @keydown="onKey">
      <Input
        v-model="query"
        :label="t('cmd.title')"
        hide-label
        :placeholder="t('cmd.placeholder')"
      />
      <ul role="listbox" class="max-h-80 overflow-auto">
        <template v-for="(it, i) in items" :key="it.id">
          <li
            v-if="i === 0 || items[i - 1].group !== it.group"
            role="presentation"
            class="px-2 pt-2 text-xs text-fg-subtle"
          >
            {{ it.group }}
          </li>
          <li
            role="option"
            :aria-selected="i === active"
            class="flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm md:py-1"
            :class="i === active ? 'bg-bg-muted' : ''"
            @mousemove="active = i"
            @click="run(it)"
          >
            <span class="truncate">{{ it.label }}</span>
            <kbd v-if="it.shortcut" class="text-xs text-fg-subtle">{{ it.shortcut }}</kbd>
          </li>
        </template>
        <li v-if="!items.length" class="px-2 py-3 text-sm text-fg-muted">{{ t('cmd.empty') }}</li>
      </ul>
    </div>
  </Dialog>
</template>
