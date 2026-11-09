<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { VueDraggable } from 'vue-draggable-plus';
import { CalendarClock, ChevronsRight, GripVertical, Sun, X } from 'lucide-vue-next';
import { StatusIcon } from '../tasks';
import DueDatePicker from '../tasks/fields/DueDatePicker.vue';
import { Button, IconButton } from '../ui';
import { openTask } from '../views';
import { localToday } from '../views/filter';
import { formatDue } from '../views/list/due';
import { carryOver, moveTo, postpone, reschedule, unplan, type DayItem, type MyDay } from './myDay';

// «My day» planner (PLANARAPP-10, PLANARAPP-58): Today, Tomorrow, Later on top of the «My day» tab (MyDay);
// a plan is dragged between the days or moved by the quick buttons; the plan comes from the parent
const props = defineProps<{ day: MyDay }>();
const { t, locale } = useI18n();
const title = computed(() =>
  new Date().toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }),
);
const left = computed(() => props.day.today.filter((x) => !x.done).length);

const BLOCKS = ['today', 'tomorrow', 'later'] as const;
type Block = (typeof BLOCKS)[number];
// the date a plan gets in the block; «Later» — in a week, as «Next week» of the task menu
const dateOf = (b: Block) => localToday(b === 'today' ? 0 : b === 'tomorrow' ? 1 : 7);
// VueDraggable reorders these copies at once; the replica (day.move) then brings the same order back
const copy = () => ({
  today: [...props.day.today],
  tomorrow: [...props.day.tomorrow],
  later: [...props.day.later],
});
const rows = ref<Record<Block, DayItem[]>>(copy());
watch(
  () => [props.day.today, props.day.tomorrow, props.day.later],
  () => (rows.value = copy()),
);
type DropEvent = { data: DayItem; newIndex?: number };
const onUpdate = (b: Block, e: DropEvent) => moveTo(props.day[b], e.data.plan.id, e.newIndex!);
// «Later» is ordered by date: a dropped plan goes to the end of its date
const onAdd = (b: Block, e: DropEvent) =>
  b === 'later'
    ? reschedule(props.day, e.data.plan.id, dateOf(b))
    : moveTo(props.day[b], e.data.plan.id, e.newIndex!, dateOf(b));
const move = (x: DayItem, date: string | null) => date && reschedule(props.day, x.plan.id, date);
</script>

<template>
  <div data-testid="my-day" class="grid gap-3 lg:grid-cols-3">
    <section
      v-for="b in BLOCKS"
      :key="b"
      :data-block="b"
      class="flex min-w-0 flex-col gap-1 rounded-lg border border-border p-3"
    >
      <!-- wraps instead of cutting the date when the block is narrow -->
      <header class="flex min-h-7 flex-wrap items-center gap-x-2">
        <Sun v-if="b === 'today'" :size="16" class="text-accent" aria-hidden="true" />
        <h2 class="text-sm font-semibold">{{ t(`myDay.block.${b}`) }}</h2>
        <span v-if="b === 'today'" class="text-xs text-fg-muted first-letter:uppercase">{{
          title
        }}</span>
        <span v-else-if="day[b].length" class="text-xs text-fg-muted">{{ day[b].length }}</span>
        <span v-if="b === 'today' && day.today.length" class="ml-auto flex items-center gap-2">
          <span class="shrink-0 text-xs text-fg-muted" data-testid="my-day-left">
            {{ t('myDay.left', { n: left, total: day.today.length }) }}
          </span>
          <IconButton
            v-if="left"
            :icon="ChevronsRight"
            :label="t('myDay.postpone')"
            size="sm"
            data-testid="my-day-postpone"
            @click="postpone(day)"
          />
        </span>
      </header>
      <!-- the hint and the drop zone share one grid cell: the block grows to a long hint (PLNRAPP-120) -->
      <div class="grid">
        <p
          v-if="!rows[b].length"
          class="pointer-events-none col-start-1 row-start-1 py-1 text-sm text-fg-muted"
        >
          {{ t(b === 'today' ? 'myDay.empty' : 'myDay.dropHere') }}
        </p>
        <VueDraggable
          v-model="rows[b]"
          handle=".handle"
          group="my-day"
          :sort="b !== 'later'"
          :class="['col-start-1 row-start-1 flex flex-col', !rows[b].length && 'min-h-10']"
          @update="(e: DropEvent) => onUpdate(b, e)"
          @add="(e: DropEvent) => onAdd(b, e)"
        >
          <div
            v-for="x in rows[b]"
            :key="x.plan.id"
            data-testid="my-day-row"
            :data-plan="x.plan.id"
            class="group flex flex-col gap-0.5 rounded-md px-1 py-1 hover:bg-bg-muted"
          >
            <!-- PLNRAPP-120: key and status, on the right the date with the move menu; below — the title up to two lines -->
            <div class="flex min-h-7 items-center gap-1">
              <span
                class="handle flex w-4 shrink-0 cursor-grab touch-none items-center justify-center text-fg-subtle"
                :aria-label="t('list.drag')"
                ><GripVertical :size="14"
              /></span>
              <StatusIcon :status="x.status" />
              <span class="text-xs text-fg-subtle">{{ x.key }}</span>
              <span class="ml-auto" />
              <!-- today / tomorrow / remove — in the menu next to the date picker -->
              <DueDatePicker
                :model-value="null"
                :label="t('myDay.pick')"
                data-testid="my-day-pick"
                @update:model-value="(d) => move(x, d)"
              >
                <template #value>
                  <!-- «Later» — the plan date; otherwise the task's due date -->
                  <span
                    v-if="b === 'later' || x.task.dueDate"
                    class="text-xs text-fg-muted"
                    data-testid="my-day-date"
                    >{{ formatDue(b === 'later' ? x.plan.date : x.task.dueDate!, locale) }}</span
                  >
                  <CalendarClock v-else :size="14" class="text-fg-muted" aria-hidden="true" />
                </template>
                <template #options="{ close }">
                  <div class="flex flex-col">
                    <Button
                      v-if="b !== 'today'"
                      size="sm"
                      variant="ghost"
                      class="justify-start"
                      data-testid="my-day-today"
                      @click="(close(), move(x, dateOf('today')))"
                      ><Sun :size="14" aria-hidden="true" />{{ t('myDay.toToday') }}</Button
                    >
                    <Button
                      v-if="b !== 'tomorrow' && !x.done"
                      size="sm"
                      variant="ghost"
                      class="justify-start"
                      data-testid="my-day-tomorrow"
                      @click="(close(), move(x, dateOf('tomorrow')))"
                      ><CalendarClock :size="14" aria-hidden="true" />{{
                        t('myDay.tomorrow')
                      }}</Button
                    >
                    <Button
                      size="sm"
                      variant="ghost"
                      class="justify-start"
                      data-testid="my-day-remove"
                      @click="(close(), unplan(x.plan.id))"
                      ><X :size="14" aria-hidden="true" />{{ t('myDay.remove') }}</Button
                    >
                  </div>
                </template>
              </DueDatePicker>
            </div>
            <button
              type="button"
              :class="[
                'line-clamp-2 rounded-md pl-5 pr-1 text-left text-sm break-words outline-none focus-visible:ring-2 ring-focus',
                x.done && 'text-fg-muted line-through',
              ]"
              @click="openTask(x.key)"
            >
              {{ x.task.title }}
            </button>
          </div>
        </VueDraggable>
      </div>
      <div
        v-if="b === 'today' && day.carry.length"
        class="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted"
        data-testid="my-day-carry"
      >
        {{ t('myDay.carry', { n: day.carry.length }) }}
        <Button size="sm" @click="carryOver(day)">{{ t('myDay.carryOver') }}</Button>
      </div>
    </section>
  </div>
</template>
