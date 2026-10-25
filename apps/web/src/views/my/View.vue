<script setup lang="ts">
import MyScreen from '../../screens/MyScreen.vue';
import type { ViewProps } from '..';

// «Мои задачи» группы: мои задачи её проектов по срокам
const props = defineProps<ViewProps>();
</script>

<template>
  <div class="h-full overflow-auto">
    <MyScreen :project-ids="props.scope?.projectIds ?? [props.projectId]" />
  </div>
</template>
