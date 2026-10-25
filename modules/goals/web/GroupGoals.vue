<script setup lang="ts">
import type { GroupScope } from '@planar/web/modules';
import GoalsPage from './GoalsPage.vue';

defineProps<{ scope: GroupScope }>();
</script>

<template>
  <!-- цели — у пространства; у Воркспейса — выбор, цели самого Воркспейса — в «Общем» -->
  <GoalsPage :space="scope.level === 'workspace' ? undefined : scope.spaceId" />
</template>
