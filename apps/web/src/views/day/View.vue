<script setup lang="ts">
import { computed } from 'vue';
import { useAuth } from '../../auth/useAuth';
import { useMyDay, type DayItem } from '../../inbox/myDay';
import MyDayPanel from '../../inbox/MyDayPanel.vue';
import type { ViewProps } from '..';

// «My day» (PLANARAPP-51): the personal plan as a view of any node — only the node's tasks
const props = defineProps<ViewProps>();
const { user } = useAuth();
const all = useMyDay(() => user.value?.id);
const mine = (x: DayItem) =>
  props.scope
    ? props.scope.projectIds.includes(x.task.projectId)
    : x.task.projectId === props.projectId;
const day = computed(() => {
  const d = all.value;
  if (!d) return undefined;
  const today = d.today.filter(mine);
  return { today, carry: d.carry.filter(mine), planned: new Set(today.map((x) => x.task.id)) };
});
</script>

<template>
  <div class="h-full overflow-y-auto p-4">
    <MyDayPanel v-if="day" :day="day" />
  </div>
</template>
