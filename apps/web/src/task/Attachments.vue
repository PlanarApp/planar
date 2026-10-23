<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Paperclip, X } from 'lucide-vue-next';
import { ApiError } from '../api/http';
import { mutate, newId } from '../sync';
import { Button } from '../ui';
import { uploadFile } from './files';
import { useAttachments } from './queries';

const props = defineProps<{ taskId: string }>();
const { t } = useI18n();
const items = useAttachments(props.taskId);
const input = ref<HTMLInputElement>();
const error = ref('');

async function addFiles(files: File[]) {
  error.value = '';
  for (const f of files) {
    try {
      const r = await uploadFile(f);
      await mutate('attachment.create', {
        id: newId(),
        taskId: props.taskId,
        fileSha256: r.sha256,
        name: f.name,
        mime: r.mime,
        size: r.size,
        width: r.width,
        height: r.height,
      });
    } catch (e) {
      error.value =
        e instanceof ApiError && e.status === 413 ? t('task.tooLarge') : t('task.uploadFailed');
    }
  }
}
const onPick = (e: Event) => {
  const el = e.target as HTMLInputElement;
  void addFiles([...(el.files ?? [])]);
  el.value = '';
};
defineExpose({ addFiles });
</script>

<template>
  <section :aria-label="t('task.attachments')">
    <h3 class="mb-1 flex items-center text-sm font-medium text-fg-muted">
      <span class="flex-1">{{ t('task.attachments') }}</span>
      <Button
        variant="ghost"
        size="sm"
        :icon="Paperclip"
        :aria-label="t('task.attach')"
        @click="input?.click()"
      />
      <input
        ref="input"
        type="file"
        multiple
        class="hidden"
        data-testid="file-input"
        @change="onPick"
      />
    </h3>
    <p v-if="error" role="alert" class="text-xs text-danger">{{ error }}</p>
    <ul class="flex flex-col gap-1">
      <li v-for="a in items" :key="a.id" class="flex items-center gap-2">
        <img
          v-if="a.mime.startsWith('image/')"
          :src="`/files/${a.fileSha256}/preview?w=256`"
          :alt="a.name"
          class="size-10 rounded-md object-cover"
        />
        <a
          :href="`/files/${a.fileSha256}?name=${encodeURIComponent(a.name)}`"
          class="flex-1 truncate text-accent hover:underline"
        >
          {{ a.name }}
        </a>
        <Button
          variant="ghost"
          size="sm"
          :icon="X"
          :aria-label="t('task.delete')"
          @click="mutate('attachment.delete', { id: a.id })"
        />
      </li>
    </ul>
  </section>
</template>
