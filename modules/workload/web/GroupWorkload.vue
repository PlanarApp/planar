<script setup lang="ts">
import type { GroupScope } from '@planar/web/modules';
import WorkloadPage from './WorkloadPage.vue';

defineProps<{ scope: GroupScope }>();
</script>

<template>
  <!-- загрузка считается по пространству; у Воркспейса — выбор пространства -->
  <WorkloadPage :space="scope.level === 'workspace' ? undefined : scope.spaceId" />
</template>
