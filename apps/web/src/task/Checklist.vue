<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { X } from 'lucide-vue-next';
import { mutate, newId, rankBetween } from '../sync';
import { Button, Input } from '../ui';
import { useChecklist } from './queries';

const props = defineProps<{ taskId: string }>();
const { t } = useI18n();
const items = useChecklist(props.taskId);
const text = ref('');

async function add() {
  const s = text.value.trim();
  if (!s) return;
  text.value = '';
  const last = items.value?.at(-1)?.rank ?? null;
  await mutate('checklist.add', {
    id: newId(),
    taskId: props.taskId,
    text: s,
    rank: rankBetween(last, null),
  });
}
</script>

<template>
  <section :aria-label="t('task.checklist')">
    <!-- the title and done/total are on the tab (PLNRAPP-100, -102) -->
    <ul>
      <li v-for="i in items" :key="i.id" class="flex min-h-11 items-center gap-2 md:min-h-8">
        <input
          type="checkbox"
          :checked="i.done"
          :aria-label="i.text"
          class="size-4 accent-[var(--color-accent)]"
          @change="mutate('checklist.update', { id: i.id, done: !i.done })"
        />
        <span :class="['flex-1', i.done && 'text-fg-subtle line-through']">{{ i.text }}</span>
        <Button
          variant="ghost"
          size="sm"
          :icon="X"
          :aria-label="t('task.delete')"
          @click="mutate('checklist.delete', { id: i.id })"
        />
      </li>
    </ul>
    <form @submit.prevent="add">
      <Input
        v-model="text"
        :label="t('task.addChecklist')"
        hide-label
        :placeholder="t('task.addChecklist')"
      />
    </form>
  </section>
</template>
