<script setup lang="ts">
// PLNRAPP-372: files of a comment — photos as thumbnails (a click — the gallery), other files — an icon and download
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, File as FileIcon, X } from '@lucide/vue';
import type { Row } from '@planar/shared';
import Gallery from './Gallery.vue';
import { downloadUrl, fileSize, isImage, previewUrl } from './commentFiles';

const props = defineProps<{ files: Row<'attachments'>[]; removable?: boolean }>();
const emit = defineEmits<{ remove: [id: string] }>();
const { t, locale } = useI18n();
/** images the browser could not show (no preview: an unknown image/* format) — shown as files */
const broken = ref(new Set<string>());
const photos = computed(() => props.files.filter((a) => isImage(a) && !broken.value.has(a.id)));
const others = computed(() => props.files.filter((a) => !photos.value.includes(a)));
const open = ref<number | null>(null);
const fail = (id: string) => (broken.value = new Set(broken.value).add(id));
</script>

<template>
  <div v-if="files.length" class="mt-1 flex flex-col gap-1" data-testid="comment-files">
    <ul v-if="photos.length" class="flex flex-wrap gap-1" :aria-label="t('task.commentFiles')">
      <li v-for="(a, i) in photos" :key="a.id" class="relative">
        <button
          type="button"
          class="block size-20 overflow-hidden rounded-md border border-border bg-bg-muted outline-none focus-visible:ring-2 ring-focus"
          :title="a.name"
          :aria-label="a.name"
          data-testid="comment-photo"
          @click="open = i"
        >
          <img
            :src="previewUrl(a)"
            :alt="a.name"
            loading="lazy"
            class="size-full object-cover"
            @error="fail(a.id)"
          />
        </button>
        <button
          v-if="removable"
          type="button"
          class="absolute -right-1 -top-1 inline-flex size-5 items-center justify-center rounded-full bg-surface text-fg-muted shadow outline-none hover:text-danger focus-visible:ring-2 ring-focus"
          :aria-label="t('task.removeFile')"
          data-testid="comment-file-remove"
          @click="emit('remove', a.id)"
        >
          <X :size="12" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <ul v-if="others.length" class="flex flex-col gap-1">
      <li
        v-for="a in others"
        :key="a.id"
        class="flex max-w-full items-center gap-2 rounded-md border border-border px-2 py-1 text-sm"
        data-testid="comment-file"
      >
        <FileIcon :size="16" class="shrink-0 text-fg-muted" aria-hidden="true" />
        <a
          :href="downloadUrl(a)"
          download
          class="min-w-0 flex-1 truncate text-accent hover:underline"
          :title="t('task.download')"
          >{{ a.name }}</a
        >
        <span class="shrink-0 text-xs text-fg-subtle">{{ fileSize(a.size, locale) }}</span>
        <a
          :href="downloadUrl(a)"
          download
          class="inline-flex size-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-muted"
          :aria-label="t('task.download')"
        >
          <Download :size="14" aria-hidden="true" />
        </a>
        <button
          v-if="removable"
          type="button"
          class="inline-flex size-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-muted hover:text-danger"
          :aria-label="t('task.removeFile')"
          data-testid="comment-file-remove"
          @click="emit('remove', a.id)"
        >
          <X :size="14" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <Gallery v-model:index="open" :items="photos" />
  </div>
</template>
