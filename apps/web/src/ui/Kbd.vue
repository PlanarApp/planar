<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ keys: string }>();
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
// 'Mod+K' → [['⌘','K']]; 'G I' → [['G'],['I']]
const groups = computed(() =>
  props.keys
    .split(' ')
    .filter(Boolean)
    .map((g) => g.split('+').map((k) => (k === 'Mod' ? (mac ? '⌘' : 'Ctrl') : k))),
);
</script>

<template>
  <span class="inline-flex items-center gap-1">
    <span v-for="(g, i) in groups" :key="i" class="inline-flex items-center gap-0.5">
      <kbd
        v-for="k in g"
        :key="k"
        class="inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-border px-0.5 font-mono text-2xs"
        >{{ k }}</kbd
      >
    </span>
  </span>
</template>
