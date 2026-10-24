<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ bars: { label: string; n: number }[] }>();
const max = computed(() => Math.max(1, ...props.bars.map((b) => b.n)));
const step = computed(() => 100 / props.bars.length);
</script>

<template>
  <div class="bars" data-test="bars">
    <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" class="svg">
      <rect
        v-for="(b, i) in bars"
        :key="i"
        data-test="bar"
        :x="i * step + step * 0.15"
        :width="step * 0.7"
        :y="50 - (b.n / max) * 50"
        :height="(b.n / max) * 50"
        fill="var(--color-accent)"
      >
        <title>{{ b.label }}: {{ b.n }}</title>
      </rect>
    </svg>
    <div class="labels">
      <span v-for="(b, i) in bars" :key="i" :title="`${b.label}: ${b.n}`">
        <b>{{ b.n }}</b> {{ b.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  min-height: 0;
}
.svg {
  flex: 1;
  min-height: 0;
  width: 100%;
  border-bottom: 1px solid var(--color-border);
}
.labels {
  display: flex;
  gap: 8px;
  font-size: var(--text-2xs);
  color: var(--color-fg-muted);
  overflow: hidden;
}
.labels span {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
