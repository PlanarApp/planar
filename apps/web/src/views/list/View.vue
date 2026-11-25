<script setup lang="ts">
// PLNRAPP-863: the project List — the reusable task list with the project's query and view options
import { computed } from 'vue';
import { useScopeTasks } from '../../tasks';
import type { ViewProps } from '..';
import TaskListView from './TaskListView.vue';

const props = defineProps<ViewProps>();
const tasks = useScopeTasks(() => props.scope?.projectIds ?? [props.projectId]);
const source = computed(() => ({ tasks: tasks.value }));
// sorting by the header changes the view options in place, as before
const settings = computed(() => ({ options: props.options }));
</script>

<template>
  <TaskListView
    :source="source"
    :settings="settings"
    :project-id="projectId"
    :filter="filter"
    :scope="scope"
  />
</template>
