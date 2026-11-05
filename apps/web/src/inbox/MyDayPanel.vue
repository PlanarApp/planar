<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { VueDraggable } from 'vue-draggable-plus';
import { CalendarClock, GripVertical, Sun, X } from 'lucide-vue-next';
import { StatusIcon } from '../tasks';
import { Button, IconButton } from '../ui';
import { openTask } from '../views';
import { carryOver, moveTo, tomorrow, unplan, type MyDay } from './myDay';

// «My day» (PLANARAPP-10): today's plan on top of the «My day» section of «My work» (MyDay); the plan comes from the parent
const props = defineProps<{ day: MyDay }>();
const { t, locale } = useI18n();
const title = computed(() =>
  new Date().toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }),
);
const left = computed(() => props.day.today.filter((x) => !x.done).length);
// VueDraggable reorders this copy at once; the replica (day.move) then brings the same order back
const rows = ref([...props.day.today]);
watch(
  () => props.day.today,
  (v) => (rows.value = [...v]),
);
</script>

<template>
  <section data-testid="my-day" class="flex flex-col gap-1 rounded-lg border border-border p-3">
    <header class="flex items-center gap-2">
      <Sun :size="16" class="text-accent" aria-hidden="true" />
      <h2 class="text-sm font-semibold">{{ t('myDay.title') }}</h2>
      <span class="text-xs text-fg-muted first-letter:uppercase">{{ title }}</span>
      <span v-if="day.today.length" class="ml-auto text-xs text-fg-muted" data-testid="my-day-left">
        {{ t('myDay.left', { n: left, total: day.today.length }) }}
      </span>
    </header>
    <p v-if="!day.today.length" class="py-1 text-sm text-fg-muted">{{ t('myDay.empty') }}</p>
    <VueDraggable
      v-model="rows"
      handle=".handle"
      class="flex flex-col"
      @update="(e) => moveTo(day, e.data.plan.id, e.newIndex!)"
    >
      <div
        v-for="x in rows"
        :key="x.plan.id"
        data-testid="my-day-row"
        :data-plan="x.plan.id"
        class="group flex min-h-10 items-center gap-1 rounded-md px-1 hover:bg-bg-muted"
      >
        <span
          class="handle flex w-4 shrink-0 cursor-grab touch-none items-center justify-center text-fg-subtle"
          :aria-label="t('list.drag')"
          ><GripVertical :size="14"
        /></span>
        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-sm outline-none focus-visible:ring-2 ring-focus"
          @click="openTask(x.key)"
        >
          <StatusIcon :status="x.status" />
          <span class="text-xs text-fg-subtle">{{ x.key }}</span>
          <span :class="['flex-1 truncate', x.done && 'text-fg-muted line-through']">{{
            x.task.title
          }}</span>
        </button>
        <IconButton
          v-if="!x.done"
          :icon="CalendarClock"
          :label="t('myDay.tomorrow')"
          size="sm"
          data-testid="my-day-tomorrow"
          @click="tomorrow(x.plan.id)"
        />
        <IconButton
          :icon="X"
          :label="t('myDay.remove')"
          size="sm"
          data-testid="my-day-remove"
          @click="unplan(x.plan.id)"
        />
      </div>
    </VueDraggable>
    <div
      v-if="day.carry.length"
      class="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted"
      data-testid="my-day-carry"
    >
      {{ t('myDay.carry', { n: day.carry.length }) }}
      <Button size="sm" @click="carryOver(day)">{{ t('myDay.carryOver') }}</Button>
    </div>
  </section>
</template>
