<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { SmilePlus } from 'lucide-vue-next';
import { TooltipProvider } from 'reka-ui';
import type { Row } from '@planar/shared';
import { IconButton, Popover, Tooltip } from '../ui';

const props = defineProps<{
  rows: Row<'commentReactions'>[];
  userId?: string;
  names: Record<string, string>;
}>();
const emit = defineEmits<{ toggle: [emoji: string] }>();
const { t } = useI18n();
const open = ref(false);
const SET = ['👍', '👎', '😄', '🎉', '😕', '❤️', '🚀', '👀'];

const chips = computed(() => {
  const m = new Map<string, Row<'commentReactions'>[]>();
  for (const r of props.rows) m.set(r.emoji, [...(m.get(r.emoji) ?? []), r]);
  return [...m].map(([emoji, rs]) => ({
    emoji,
    count: rs.length,
    mine: rs.some((r) => r.userId === props.userId),
    who: rs.map((r) => props.names[r.userId] ?? '—').join(', '),
  }));
});
const pick = (e: string) => {
  open.value = false;
  emit('toggle', e);
};
</script>

<template>
  <TooltipProvider>
    <div class="mt-1 flex flex-wrap items-center gap-1">
      <Tooltip v-for="c in chips" :key="c.emoji" :content="c.who">
        <button
          type="button"
          data-testid="reaction"
          :aria-pressed="c.mine"
          :class="[
            'flex h-6 items-center gap-1 rounded-full border px-2 text-xs',
            c.mine ? 'border-accent bg-bg-muted text-accent' : 'border-border text-fg-muted',
          ]"
          @click="emit('toggle', c.emoji)"
        >
          <span>{{ c.emoji }}</span>
          <span>{{ c.count }}</span>
        </button>
      </Tooltip>
      <Popover v-model:open="open">
        <template #trigger>
          <IconButton
            size="sm"
            :icon="SmilePlus"
            :label="t('task.addReaction')"
            data-testid="reaction-add"
          />
        </template>
        <div class="flex gap-1">
          <button
            v-for="e in SET"
            :key="e"
            type="button"
            data-testid="reaction-pick"
            class="size-8 rounded-md text-lg hover:bg-bg-muted"
            @click="pick(e)"
          >
            {{ e }}
          </button>
        </div>
      </Popover>
      <!-- the comment's actions — in the same row (PLNRAPP-108) -->
      <slot />
    </div>
  </TooltipProvider>
</template>
