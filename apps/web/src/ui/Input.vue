<script setup lang="ts">
import { useId } from 'vue';

defineProps<{
  label: string;
  hideLabel?: boolean;
  type?: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
}>();
const model = defineModel<string>({ default: '' });
const id = useId();
</script>

<template>
  <div class="flex flex-col gap-1">
    <label :for="id" :class="hideLabel ? 'sr-only' : 'text-sm text-fg-muted'">{{ label }}</label>
    <input
      :id="id"
      v-model="model"
      :type="type ?? 'text'"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="error ? id + '-err' : undefined"
      class="h-11 md:h-8 rounded-md border border-border-strong bg-bg px-2.5 text-base text-fg placeholder:text-fg-subtle outline-none focus-visible:ring-2 ring-focus disabled:bg-bg-muted"
    />
    <p v-if="error" :id="id + '-err'" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
