<script setup lang="ts">
import { COLORS } from './colors';

defineProps<{ disabled?: boolean }>();
const model = defineModel<string>({ required: true });
</script>

<template>
  <div class="flex flex-wrap gap-1" role="radiogroup">
    <button
      v-for="c in COLORS"
      :key="c"
      type="button"
      role="radio"
      :aria-checked="model === c"
      :aria-label="c"
      :disabled="disabled"
      class="size-6 rounded-full border-2 md:size-5"
      :class="model === c ? 'border-fg' : 'border-transparent'"
      :style="{ background: c }"
      @click="model = c"
    />
  </div>
</template>
