<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import IconButton from '../../ui/IconButton.vue';

// non-blocking corner prompt for unsaved view/filter changes; the buttons come in the slot.
// "×" hides it until the next edit (state changes).
const props = defineProps<{ show: boolean; state: unknown }>();
const { t } = useI18n();
const hidden = ref(false);
watch(
  () => [props.show, props.state],
  () => (hidden.value = false),
  { deep: true },
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show && !hidden"
      role="region"
      :aria-label="t('views.saved.changed')"
      class="fixed bottom-16 right-4 z-50 flex items-center gap-1 rounded-lg border border-border bg-bg py-1 pl-3 pr-1 text-sm text-fg shadow-lg md:bottom-4"
      data-testid="view-changes"
    >
      <span class="mr-1 text-fg-muted">{{ t('views.saved.changed') }}</span>
      <slot />
      <IconButton size="sm" :icon="X" :label="t('ui.close')" @click="hidden = true" />
    </div>
  </Teleport>
</template>
