<script setup lang="ts">
import { computed } from 'vue';
import { useRouter, type GroupScope } from '@planar/web/modules';
import BoardsPage from './BoardsPage.vue';
import BoardPage from './BoardPage.vue';

// Reports › group Dashboards: the list and the dashboard itself — in the same group (?board=<id>)
defineProps<{ scope: GroupScope }>();
const router = useRouter();
const q = () => router.currentRoute.value.query;
const board = computed(() => (typeof q().board === 'string' ? (q().board as string) : ''));
const open = (id: string) => void router.push({ query: { ...q(), board: id } });
const back = () => void router.push({ query: { ...q(), board: undefined } });
</script>

<template>
  <BoardPage v-if="board" :key="board" :board-id="board" :back="back" />
  <BoardsPage
    v-else
    :space="scope.level === 'workspace' ? undefined : scope.spaceId"
    :open="open"
  />
</template>
