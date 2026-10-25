<script setup lang="ts">
import type { GroupScope } from '@planar/web/modules';
import WeekPage from './WeekPage.vue';

defineProps<{ scope: GroupScope }>();
</script>

<template>
  <WeekPage :scope="scope" />
</template>
