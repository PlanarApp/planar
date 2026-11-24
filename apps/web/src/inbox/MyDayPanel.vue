<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CalendarClock, ChevronDown, ChevronRight, ChevronsRight, Sun, X } from 'lucide-vue-next';
import { useLabels, useMembers } from '../tasks';
import DueDatePicker from '../tasks/fields/DueDatePicker.vue';
import { Button, IconButton, useBreakpoint } from '../ui';
import { toast } from '../ui/toast';
import { openTask } from '../views';
import { localToday } from '../views/filter';
import { formatDue } from '../views/list/due';
import TaskCard from '../views/list/TaskCard.vue';
import { carryOver, postpone, setDue, unplan, type DayItem, type MyDay } from './myDay';

// «My day» planner (PLANARAPP-10, PLANARAPP-58, PLNRAPP-709): Today, Tomorrow, Later by the tasks' due date
// on top of the «My day» tab (MyDay); the quick buttons change dueDate; the day comes from the parent
const props = defineProps<{ day: MyDay }>();
const { t, locale } = useI18n();
const title = computed(() =>
  new Date().toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }),
);
const left = computed(() => props.day.today.filter((x) => !x.done).length);

const BLOCKS = ['today', 'tomorrow', 'later'] as const;
// PLNRAPP-823: the rows are the List cards (the name on one line); dictionaries — of the tasks' spaces
const { isMobile } = useBreakpoint();
const spaceIds = computed(() =>
  [...new Set(BLOCKS.flatMap((b) => props.day[b].map((x) => x.task.spaceId)))].sort().join(','),
);
const members = useMembers(spaceIds);
const labels = useLabels(spaceIds);
// the filled fields in the order of the List card; the due date — the move menu on the right
const cols = (x: DayItem) =>
  (['project', 'priority', 'labels', 'assignee'] as const).filter(
    (c) =>
      c === 'project' ||
      (c === 'priority'
        ? !!x.task.priority
        : c === 'labels'
          ? x.task.labelIds.length > 0
          : x.task.assigneeIds.length > 0),
  );
// field pickers are mounted for the card under the cursor (always on mobile), as in the List
const hover = ref<string>();
const move = (x: DayItem, date: string | null) => date && setDue(x.task.id, date);

// PLNRAPP-850: done and cancelled tasks of a block go under a collapsed cut «Completed (N)» at its end;
// the cut is collapsed on every open (the state is not stored), the rows under it are the same rows
type Block = (typeof BLOCKS)[number];
type Entry = DayItem | { cut: number };
const expanded = ref(new Set<Block>());
const toggle = (b: Block) => {
  const s = new Set(expanded.value);
  if (!s.delete(b)) s.add(b);
  expanded.value = s;
};
const entries = (b: Block): Entry[] => {
  const open = props.day[b].filter((x) => !x.done);
  const closed = props.day[b].filter((x) => x.done);
  return [
    ...open,
    ...(closed.length ? [{ cut: closed.length }] : []),
    ...(expanded.value.has(b) ? closed : []),
  ];
};

// PLNRAPP-813: the bulk move is one transaction; while it runs the buttons are disabled (no second batch
// on a repeated tap), a local error is shown — the replica is rolled back by the transaction
const busy = ref(false);
async function bulk(f: (day: MyDay) => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await f(props.day);
  } catch (e) {
    console.error(e);
    toast(t('myDay.moveFailed'));
  } finally {
    busy.value = false;
  }
}
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
            :disabled="busy"
            @click="bulk(postpone)"
          />
        </span>
      </header>
      <div class="flex flex-col">
        <p v-if="!day[b].length" class="py-1 text-sm text-fg-muted">
          {{ t(b === 'today' ? 'myDay.empty' : 'myDay.none') }}
        </p>
        <template v-for="x in entries(b)" :key="'cut' in x ? 'cut' : x.task.id">
          <button
            v-if="'cut' in x"
            type="button"
            data-testid="my-day-cut"
            :aria-expanded="expanded.has(b)"
            :class="[
              'mt-1 flex w-full items-center gap-1 rounded-md px-1 text-left text-xs text-fg-muted outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus',
              isMobile ? 'min-h-11' : 'min-h-7',
            ]"
            @click="toggle(b)"
          >
            <component
              :is="expanded.has(b) ? ChevronDown : ChevronRight"
              :size="14"
              aria-hidden="true"
            />{{ t('myDay.completed', { n: x.cut }) }}
          </button>
          <div
            v-else
            data-testid="my-day-row"
            :data-task="x.task.id"
            tabindex="0"
            :class="[
              'group flex min-w-0 cursor-pointer items-start gap-1 rounded-md px-1 py-1 outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus',
              x.done && '[&_p]:text-fg-muted [&_p]:line-through',
            ]"
            @mouseenter="hover = x.task.id"
            @mouseleave="hover = undefined"
            @click="openTask(x.key)"
            @keydown.enter.self="openTask(x.key)"
          >
            <!-- PLNRAPP-823: the List card without wrapping; on the right the date with the move menu -->
            <div class="min-w-0 flex-1">
              <TaskCard
                head
                show-key
                project-text
                :task="x.task"
                :space-id="x.task.spaceId"
                :cols="cols(x)"
                :blocked="false"
                :hot="isMobile || hover === x.task.id"
                :members="members ?? []"
                :labels="labels ?? []"
                :project-name="x.project"
              />
            </div>
            <!-- today / tomorrow / remove — in the menu next to the date picker -->
            <div class="flex h-7 shrink-0 items-center" @click.stop>
              <DueDatePicker
                :model-value="null"
                :label="t('myDay.pick')"
                data-testid="my-day-pick"
                @update:model-value="(d) => move(x, d)"
              >
                <template #value>
                  <span class="text-xs text-fg-muted" data-testid="my-day-date">{{
                    formatDue(x.task.dueDate!, locale)
                  }}</span>
                </template>
                <template #options="{ close }">
                  <div class="flex flex-col">
                    <Button
                      v-if="b !== 'today'"
                      size="sm"
                      variant="ghost"
                      class="justify-start"
                      data-testid="my-day-today"
                      @click="(close(), move(x, localToday()))"
                      ><Sun :size="14" aria-hidden="true" />{{ t('myDay.toToday') }}</Button
                    >
                    <Button
                      v-if="b !== 'tomorrow' && !x.done"
                      size="sm"
                      variant="ghost"
                      class="justify-start"
                      data-testid="my-day-tomorrow"
                      @click="(close(), move(x, localToday(1)))"
                      ><CalendarClock :size="14" aria-hidden="true" />{{
                        t('myDay.tomorrow')
                      }}</Button
                    >
                    <Button
                      size="sm"
                      variant="ghost"
                      class="justify-start"
                      data-testid="my-day-remove"
                      @click="(close(), unplan(x.task.id))"
                      ><X :size="14" aria-hidden="true" />{{ t('myDay.remove') }}</Button
                    >
                  </div>
                </template>
              </DueDatePicker>
            </div>
          </div>
        </template>
      </div>
      <div
        v-if="b === 'today' && day.carry.length"
        class="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted"
        data-testid="my-day-carry"
      >
        {{ t('myDay.carry', { n: day.carry.length }) }}
        <Button size="sm" :disabled="busy" @click="bulk(carryOver)">{{
          t('myDay.carryOver')
        }}</Button>
      </div>
    </section>
  </div>
</template>
