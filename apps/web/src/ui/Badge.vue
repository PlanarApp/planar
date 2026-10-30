<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ variant?: 'solid' | 'soft' | 'outline'; color?: string; dot?: boolean }>(),
  { variant: 'soft' },
);
// color — a value from data (status, label), an allowed literal
const style = computed(() => {
  const c = props.color ?? 'var(--color-fg-muted)';
  if (props.dot) return {};
  if (props.variant === 'solid') return { background: c, color: 'var(--color-bg)' };
  if (props.variant === 'outline') return { border: `1px solid ${c}`, color: c };
  return { background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c };
});
</script>

<template>
  <span
    :class="[
      'inline-flex h-5 items-center rounded-sm text-xs font-medium',
      dot ? 'gap-1 text-fg-muted' : 'px-1.5',
    ]"
    :style="style"
  >
    <span
      v-if="dot"
      class="size-2 shrink-0 rounded-full"
      :style="{ background: color ?? 'var(--color-fg-muted)' }"
    />
    <slot />
  </span>
</template>
