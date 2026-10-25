<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { Hash } from 'lucide-vue-next';
import { Badge, groupUrl, type GroupScope } from '@planar/web/modules';
import { useChatData } from './data';
import { byName } from './model';

// ветка «Чаты» в меню: каналы только уровня группы
const props = defineProps<{ scope: GroupScope }>();
const route = useRoute();
const { d, unreadOf } = useChatData();
const id = computed(() =>
  props.scope.level === 'project' ? props.scope.projectId! : props.scope.spaceId,
);
const items = computed(() =>
  (d.value?.channels ?? [])
    .filter(
      (c) =>
        c.kind === 'channel' &&
        !c.archivedAt &&
        c.spaceId === props.scope.spaceId &&
        (c.projectId ?? null) === props.scope.projectId,
    )
    .sort((a, b) => byName(a.name ?? '', b.name ?? '')),
);
</script>

<template>
  <RouterLink
    v-for="c in items"
    :key="c.id"
    :to="{ path: groupUrl(scope.level, id, 'chats'), query: { c: c.id } }"
    :class="[
      'flex h-7 items-center gap-1.5 rounded-md pl-6 pr-2 text-sm hover:bg-bg-muted',
      route.query.c === c.id && 'bg-accent-subtle',
    ]"
  >
    <Hash :size="14" class="shrink-0 text-fg-subtle" /><span class="truncate">{{ c.name }}</span>
    <Badge
      v-if="unreadOf(c) > 0"
      variant="solid"
      color="var(--color-accent)"
      class="ml-auto text-accent-fg!"
      >{{ unreadOf(c) }}</Badge
    >
  </RouterLink>
</template>
