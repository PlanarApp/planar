<script setup lang="ts">
import type { StyleValue } from 'vue';
import { userIcon } from './avatar';
import type { PickUser } from './UserPicker.vue';

/**
 * The editor hint at the cursor (PLNRAPP-827): «@» — people with avatars, like in UserPicker;
 * «/», «#» — plain rows. The editor keeps the highlighted index and the keys; the press does not
 * take the focus from the text.
 */
export interface SuggestItem {
  key: string;
  label: string;
  /** a person — the row gets the avatar of the user picker */
  user?: PickUser;
}
defineProps<{
  items: readonly SuggestItem[];
  index: number;
  label: string;
  /** position at the cursor (fixed) */
  position?: StyleValue;
}>();
const emit = defineEmits<{ pick: [i: number] }>();
</script>

<template>
  <ul
    role="listbox"
    :aria-label="label"
    data-testid="suggest-list"
    class="fixed z-50 max-h-64 min-w-44 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-md"
    :style="position"
  >
    <li
      v-for="(it, i) in items"
      :key="it.key"
      role="option"
      :aria-selected="i === index"
      :data-testid="it.user ? 'suggest-user' : undefined"
      :class="[
        'flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-base text-fg',
        i === index && 'bg-bg-muted',
      ]"
      @mousedown.prevent="emit('pick', i)"
    >
      <component
        :is="userIcon(it.user).icon"
        v-if="it.user"
        v-bind="userIcon(it.user).iconProps"
        class="shrink-0"
      />
      <span class="min-w-0 truncate">{{ it.label }}</span>
    </li>
  </ul>
</template>
