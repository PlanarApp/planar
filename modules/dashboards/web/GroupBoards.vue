<script setup lang="ts">
import type { GroupScope } from '@planar/web/modules';
import BoardsPage from './BoardsPage.vue';

defineProps<{ scope: GroupScope }>();
</script>

<template>
  <!-- shortcut: дашборд открывается на /m/dashboards/<id>, вне группы; встроить, если попросят -->
  <BoardsPage :space="scope.level === 'workspace' ? undefined : scope.spaceId" />
</template>
