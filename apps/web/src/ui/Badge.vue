<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ variant?: 'solid' | 'soft' | 'outline'; color?: string }>(),
  { variant: 'soft' },
);
// color — значение из данных (статус, метка), допустимый литерал
const style = computed(() => {
  const c = props.color ?? 'var(--color-fg-muted)';
  if (props.variant === 'solid') return { background: c, color: 'var(--color-bg)' };
  if (props.variant === 'outline') return { border: `1px solid ${c}`, color: c };
  return { background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c };
});
</script>

<template>
  <span
    class="inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium"
    :style="style"
  >
    <slot />
  </span>
</template>
