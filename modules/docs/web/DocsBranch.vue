<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { groupUrl, type GroupScope } from '@planar/web/modules';
import PageTree from './PageTree.vue';

// ветка «Документы» в меню: страницы только уровня группы
const props = defineProps<{ scope: GroupScope }>();
const route = useRoute();
const id = computed(() => (props.scope.level === 'project' ? props.scope.projectId! : props.scope.spaceId));
const sections = computed(() => [
  { key: id.value, spaceId: props.scope.spaceId, projectId: props.scope.projectId },
]);
const link = (page: string) => ({
  path: groupUrl(props.scope.level, id.value, 'docs'),
  query: { page },
});
</script>

<template>
  <PageTree
    :sections="sections"
    :link="link"
    :current="typeof route.query.page === 'string' ? route.query.page : undefined"
  />
</template>
