<script setup lang="ts">
import { Ban } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { COLORS } from './colors';

/** clearable — the first option "no color" (model '') */
defineProps<{ disabled?: boolean; clearable?: boolean }>();
const model = defineModel<string>({ required: true });
const { t } = useI18n();
</script>

<template>
  <div class="flex flex-wrap gap-1" role="radiogroup">
    <button
      v-if="clearable"
      type="button"
      role="radio"
      :aria-checked="!model"
      :aria-label="t('settings.general.noColor')"
      :title="t('settings.general.noColor')"
      :disabled="disabled"
      class="flex size-6 items-center justify-center rounded-full border-2 text-fg-muted md:size-5"
      :class="!model ? 'border-fg' : 'border-border'"
      data-testid="color-none"
      @click="model = ''"
    >
      <Ban :size="12" aria-hidden="true" />
    </button>
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
