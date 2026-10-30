<script setup lang="ts">
// node icon (Workspace, space, project): 'file:<sha256>' — an image, otherwise emoji
defineProps<{ icon: string }>();
</script>

<template>
  <img
    v-if="icon.startsWith('file:')"
    :src="`/files/${icon.slice(5)}/preview?w=256`"
    alt=""
    class="size-full rounded-[inherit] object-cover"
  />
  <template v-else>{{ icon }}</template>
</template>
