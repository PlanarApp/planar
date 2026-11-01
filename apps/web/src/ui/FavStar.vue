<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Star } from 'lucide-vue-next';
import Tooltip from './Tooltip.vue';

// favourite toggle: grey star — not in favourites, yellow filled — in favourites
defineOptions({ inheritAttrs: false });
defineProps<{ fav: boolean }>();
const { t } = useI18n();
</script>

<template>
  <Tooltip :content="t(fav ? 'sidebar.unfavorite' : 'sidebar.favorite')">
    <button
      v-bind="$attrs"
      type="button"
      :aria-label="t(fav ? 'sidebar.unfavorite' : 'sidebar.favorite')"
      :aria-pressed="fav"
      class="inline-flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-bg-muted outline-none focus-visible:outline-2 focus-visible:outline-focus md:size-7"
    >
      <Star
        :size="16"
        :class="fav ? 'fill-current text-warning' : 'text-fg-subtle hover:text-fg-muted'"
      />
    </button>
  </Tooltip>
</template>
