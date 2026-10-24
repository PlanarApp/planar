<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ points: { start: string; n: number }[] }>();
const max = computed(() => Math.max(1, ...props.points.map((p) => p.n)));
const pts = computed(() =>
  props.points
    .map((p, i) => {
      const x = props.points.length > 1 ? (i / (props.points.length - 1)) * 100 : 50;
      return `${x},${50 - (p.n / max.value) * 48 - 1}`;
    })
    .join(' '),
);
</script>

<template>
  <div class="line" data-test="line">
    <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" class="svg">
      <polyline
        :points="pts"
        fill="none"
        stroke="var(--color-accent)"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    </svg>
    <div class="labels">
      <span>{{ points[0]?.start }}</span>
      <span>max {{ max }}</span>
      <span>{{ points[points.length - 1]?.start }}</span>
    </div>
  </div>
</template>

<style scoped>
.line {
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
  justify-content: space-between;
  font-size: var(--text-2xs);
  color: var(--color-fg-muted);
}
</style>
