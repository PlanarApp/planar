<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Dialog } from '../ui';
import { hotkeys, ui } from './hotkeys';

const { t } = useI18n();
</script>

<template>
  <Dialog v-model:open="ui.cheat" :title="t('cmd.cheat')">
    <ul class="flex flex-col gap-1">
      <li
        v-for="h in hotkeys.filter((x) => x.label)"
        :key="h.combo"
        class="flex justify-between text-sm"
      >
        <span>{{ t(h.label!) }}</span>
        <kbd class="text-fg-muted">{{ h.combo.replace('mod+k', 'Ctrl/⌘ K') }}</kbd>
      </li>
    </ul>
  </Dialog>
</template>
