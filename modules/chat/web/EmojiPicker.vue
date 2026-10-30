<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

// эмодзи-пикер (web component) — свой чанк и данные из пакета, без CDN; монтируется только открытым
const emit = defineEmits<{ pick: [emoji: string] }>();
const host = ref<HTMLElement | null>(null);
let el: HTMLElement | undefined;
const onPick = (e: Event) => {
  const u = (e as CustomEvent<{ unicode?: string }>).detail.unicode;
  if (u) emit('pick', u);
};
onMounted(async () => {
  const [{ Picker }, { default: i18n }, { default: dataSource }] = await Promise.all([
    import('emoji-picker-element'),
    import('emoji-picker-element/i18n/ru_RU.js'),
    import('emoji-picker-element-data/ru/emojibase/data.json?url'),
  ]);
  if (!host.value) return;
  el = new Picker({ locale: 'ru', i18n, dataSource });
  el.addEventListener('emoji-click', onPick);
  host.value.append(el);
});
onBeforeUnmount(() => el?.removeEventListener('emoji-click', onPick));
</script>

<template>
  <div ref="host" class="emoji-host" data-testid="emoji-picker" />
</template>

<style>
.emoji-host emoji-picker {
  --background: var(--color-surface);
  --border-color: var(--color-border);
  --input-border-color: var(--color-border-strong);
  --input-font-color: var(--color-fg);
  --category-font-color: var(--color-fg-muted);
  --indicator-color: var(--color-accent);
  --button-hover-background: var(--color-bg-muted);
  --button-active-background: var(--color-bg-muted);
  height: 22rem;
}
</style>
