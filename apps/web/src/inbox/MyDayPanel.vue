<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CalendarClock, ChevronsRight, Sun, X } from 'lucide-vue-next';
import { StatusIcon } from '../tasks';
import DueDatePicker from '../tasks/fields/DueDatePicker.vue';
import { Button, IconButton } from '../ui';
import { openTask } from '../views';
import { localToday } from '../views/filter';
import { formatDue } from '../views/list/due';
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
const move = (x: DayItem, date: string | null) => date && setDue(x.task.id, date);
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
      <div class="flex flex-col">
        <p v-if="!day[b].length" class="py-1 text-sm text-fg-muted">
          {{ t(b === 'today' ? 'myDay.empty' : 'myDay.none') }}
        </p>
        <div
          v-for="x in day[b]"
          :key="x.task.id"
          data-testid="my-day-row"
          :data-task="x.task.id"
          class="group flex flex-col gap-0.5 rounded-md px-1 py-1 hover:bg-bg-muted"
        >
          <!-- PLNRAPP-120: key and status, on the right the date with the move menu; below — the title up to two lines -->
          <div class="flex min-h-7 items-center gap-1">
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
