<script setup lang="ts">
import { computed } from 'vue';
import { useScopeTasks } from '../tasks';
import type { ViewOptions, ViewProps } from '../views';
import TaskListView from '../views/list/TaskListView.vue';
import { MY_DAY_FILTER } from './myDay';

// «My day» tab of «My work» (PLNRAPP-864): the List of the level's projects with the «My day» filter;
// options — the level's List settings (the «View» menu of the tab changes them); its Me Mode is not applied
const props = defineProps<{
  projectId: string;
  scope: NonNullable<ViewProps['scope']>;
  options: ViewOptions;
}>();
const tasks = useScopeTasks(() => props.scope.projectIds);
const source = computed(() => ({ tasks: tasks.value }));
const settings = computed(() => ({
  options: { ...props.options, me: null },
  update: (patch: Partial<ViewOptions>) => Object.assign(props.options, patch),
}));
</script>

<template>
  <TaskListView
    data-testid="my-day"
    :source="source"
    :settings="settings"
    :project-id="projectId"
    :filter="MY_DAY_FILTER"
    :scope="scope"
  />
</template>
