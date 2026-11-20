<script setup lang="ts">
import type { ViewProps } from '..';
import ListView from '../list/View.vue';

// the Cards view: the List (groups, sorting, menu) drawn as task cards, without the column header
defineProps<ViewProps>();
</script>

<template>
  <ListView v-bind="$props" cards />
</template>
