<script setup lang="ts">
// иконка узла (Воркспейс, пространство, проект): 'file:<sha256>' — картинка, иначе эмодзи
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
