<script setup lang="ts">
// PLNRAPP-372: «attach a photo or file» of a comment composer
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Paperclip } from 'lucide-vue-next';
import { IconButton } from '../ui';
import type { DraftFiles } from './commentFiles';

const props = defineProps<{ draft: DraftFiles }>();
const { t } = useI18n();
const input = ref<HTMLInputElement>();
function onPick(e: Event) {
  const el = e.target as HTMLInputElement;
  void props.draft.add([...(el.files ?? [])]);
  el.value = '';
}
</script>

<template>
  <IconButton
    size="sm"
    :icon="Paperclip"
    :label="t('task.attachToComment')"
    data-testid="comment-attach"
    @click="input?.click()"
  />
  <input
    ref="input"
    type="file"
    multiple
    class="hidden"
    data-testid="comment-file-input"
    @change="onPick"
  />
</template>
