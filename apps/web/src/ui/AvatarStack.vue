<script setup lang="ts">
import { computed } from 'vue';
import Avatar from './Avatar.vue';

const props = withDefaults(
  defineProps<{
    people: { name: string; src?: string | null }[];
    max?: number;
    size?: 'xs' | 'sm';
  }>(),
  { max: 3, size: 'sm' },
);
const shown = computed(() => props.people.slice(0, props.max));
const rest = computed(() => props.people.length - shown.value.length);
const dim = computed(() => (props.size === 'xs' ? 'size-4' : 'size-5'));
</script>

<template>
  <span
    v-if="people.length"
    class="inline-flex items-center"
    :title="people.map((p) => p.name).join(', ')"
  >
    <Avatar
      v-for="(p, i) in shown"
      :key="i"
      :name="p.name"
      :src="p.src"
      :size="size"
      :class="['ring-2 ring-bg', i > 0 && '-ml-1']"
      title=""
    />
    <span
      v-if="rest > 0"
      :class="[
        '-ml-1 inline-flex items-center justify-center rounded-full bg-bg-muted text-2xs text-fg-muted ring-2 ring-bg',
        dim,
      ]"
      >+{{ rest }}</span
    >
  </span>
</template>
