<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { CalendarClock } from '@lucide/vue';
import { useScopeTasks, type TaskView } from '../tasks';
import type { ViewOptions, ViewProps } from '../views';
import { Button } from '../ui';
import { localToday } from '../views/filter';
import TaskListView from '../views/list/TaskListView.vue';
import { dayBlocks, MY_DAY_FILTER, planFor } from './myDay';

// «My day» tab of «My work» (PLNRAPP-864, PLNRAPP-868): the List of the level's projects with the «My day»
// filter in the blocks «Today / Tomorrow / Later»; the rows follow the level's List settings (fields, their
// order, density — the «View» menu of the tab changes them); its grouping, sorting and Me Mode are not applied
const props = defineProps<{
  projectId: string;
  scope: NonNullable<ViewProps['scope']>;
  options: ViewOptions;
}>();
const { t } = useI18n();
const tasks = useScopeTasks(() => props.scope.projectIds);
const source = computed(() => ({ tasks: tasks.value }));
const settings = computed(() => ({
  options: { ...props.options, me: null },
  update: (patch: Partial<ViewOptions>) => Object.assign(props.options, patch),
}));
const blocks = (list: TaskView[]) => dayBlocks(list, (b) => t(`myDay.${b}`));
// «All for tomorrow»: the whole «Today» block, overdue included
const allToTomorrow = (list: TaskView[]) =>
  Promise.all(list.map((x) => planFor(x.id, localToday(1))));
</script>

<template>
  <TaskListView
    data-testid="my-day"
    :source="source"
    :settings="settings"
    :project-id="projectId"
    :filter="MY_DAY_FILTER"
    :scope="scope"
    :groups="blocks"
    :dnd="false"
    :quick-create="false"
  >
    <template #group-actions="{ group }">
      <Button
        v-if="group.key === 'today' && group.tasks.length"
        size="sm"
        variant="ghost"
        data-testid="my-day-all-tomorrow"
        @click="allToTomorrow(group.tasks)"
        ><CalendarClock :size="14" aria-hidden="true" />{{ t('myDay.allToTomorrow') }}</Button
      >
    </template>
  </TaskListView>
</template>
