<script setup lang="ts">
// PLNRAPP-372: a composer with files — drag & drop onto it, the files being uploaded (progress, cancel) and ready ones
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { File as FileIcon, X } from 'lucide-vue-next';
import { fileSize, type DraftFiles } from './commentFiles';

const props = defineProps<{ draft: DraftFiles }>();
const { t, locale } = useI18n();
const over = ref(0);
const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
function onDrop(e: DragEvent) {
  over.value = 0;
  if (!e.dataTransfer?.files.length) return;
  e.stopPropagation(); // the comment's files, not the task's (TaskDetail drop)
  // the editor took it (Editor `files`: emits attach) — not twice
  if (e.defaultPrevented) return;
  e.preventDefault();
  void props.draft.add([...e.dataTransfer.files]);
}
</script>

<template>
  <div
    class="relative"
    @dragenter="(e) => hasFiles(e) && over++"
    @dragleave="over = Math.max(0, over - 1)"
    @dragover="(e) => hasFiles(e) && e.preventDefault()"
    @drop="onDrop"
  >
    <slot />
    <ul v-if="draft.items.value.length" class="mt-2 flex flex-wrap gap-1" data-testid="draft-files">
      <li
        v-for="d in draft.items.value"
        :key="d.key"
        :class="[
          'relative flex w-40 max-w-full items-center gap-2 overflow-hidden rounded-md border px-2 py-1 text-xs',
          d.state === 'error' ? 'border-danger' : 'border-border',
        ]"
        data-testid="draft-file"
        :data-state="d.state"
      >
        <img v-if="d.url" :src="d.url" alt="" class="size-8 shrink-0 rounded object-cover" />
        <FileIcon v-else :size="16" class="shrink-0 text-fg-muted" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <div class="truncate" :title="d.name">{{ d.name }}</div>
          <div
            :class="d.state === 'error' ? 'text-danger' : 'text-fg-subtle'"
            :role="d.state === 'error' ? 'alert' : undefined"
          >
            {{
              d.state === 'error'
                ? t(`task.${d.error}`)
                : d.state === 'uploading'
                  ? `${t('task.uploading')} ${Math.round(d.progress * 100)}%`
                  : fileSize(d.size, locale)
            }}
          </div>
        </div>
        <button
          type="button"
          class="inline-flex size-6 shrink-0 items-center justify-center rounded text-fg-muted outline-none hover:bg-bg-muted hover:text-danger focus-visible:ring-2 ring-focus"
          :aria-label="t(d.state === 'uploading' ? 'task.cancelUpload' : 'task.removeFile')"
          data-testid="draft-file-remove"
          @click="draft.remove(d.key)"
        >
          <X :size="14" aria-hidden="true" />
        </button>
        <div
          v-if="d.state === 'uploading'"
          class="absolute bottom-0 left-0 h-0.5 bg-accent transition-[width]"
          :style="{ width: `${Math.round(d.progress * 100)}%` }"
          role="progressbar"
          :aria-valuenow="Math.round(d.progress * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
        />
      </li>
    </ul>
    <div v-if="$slots.actions" class="mt-2 flex items-center gap-2"><slot name="actions" /></div>
    <div
      v-if="over"
      class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-accent bg-accent-subtle/80 text-sm font-medium"
    >
      {{ t('task.dropFiles') }}
    </div>
  </div>
</template>
