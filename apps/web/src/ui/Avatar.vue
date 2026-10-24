<script setup lang="ts">
import { computed } from 'vue';
import { AvatarFallback, AvatarImage, AvatarRoot } from 'reka-ui';

const props = withDefaults(
  defineProps<{ name: string; src?: string | null; size?: 'xs' | 'sm' | 'md' | 'lg' }>(),
  { size: 'md' },
);
const px = { xs: 16, sm: 20, md: 24, lg: 32 };
const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join(''),
);
const hue = computed(() => [...props.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0));
</script>

<template>
  <AvatarRoot
    class="inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full align-middle"
    :style="{ width: px[size] + 'px', height: px[size] + 'px' }"
    :title="name"
  >
    <AvatarImage v-if="src" :src="src" :alt="name" class="size-full object-cover" />
    <AvatarFallback
      class="flex size-full items-center justify-center font-medium text-white"
      :style="{ background: `hsl(${hue} 45% 40%)`, fontSize: px[size] * 0.42 + 'px' }"
      :delay-ms="src ? 300 : undefined"
    >
      {{ initials }}
    </AvatarFallback>
  </AvatarRoot>
</template>
