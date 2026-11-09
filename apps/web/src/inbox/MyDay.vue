<script setup lang="ts">
import { computed } from 'vue';
import { useAuth } from '../auth/useAuth';
import { dayIn, useMyDay } from './myDay';
import MyDayPanel from './MyDayPanel.vue';

// «My day» tab of a group's «My work» (PLANARAPP-52, PLANARAPP-57): the planner of the group's projects (with nested);
// my tasks due now are the regular view below it (ScopeTasks, Me Mode 'day' — PLNRAPP-137)
const props = defineProps<{ projectIds: string[] }>();
const { user } = useAuth();
const day = useMyDay(() => user.value?.id);
const shown = computed(() => day.value && dayIn(day.value, props.projectIds));
</script>

<template>
  <div class="p-4">
    <MyDayPanel v-if="shown" :day="shown" />
  </div>
</template>
