<script setup lang="ts">
import { GroupProjectPick, type GroupScope } from '@planar/web/modules';
import MilestonesView from './MilestonesView.vue';

defineProps<{ scope: GroupScope }>();
</script>

<template>
  <GroupProjectPick v-slot="{ projectId }" :scope="scope">
    <MilestonesView :key="projectId" :project-id="projectId" />
  </GroupProjectPick>
</template>
