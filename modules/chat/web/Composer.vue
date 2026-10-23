<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { Paperclip, Send, X } from 'lucide-vue-next';
import {
  ApiError,
  Button,
  Editor,
  mutate,
  newId,
  onMutationError,
  sendTyping,
  uploadFile,
} from '@planar/web/modules';
import { plain } from './model';
import { useTexts } from './text';

const props = defineProps<{
  channelId: string;
  parentId?: string;
  members: { id: string; name: string }[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ sent: [id: string] }>();
const tx = useTexts();

interface Att {
  fileSha256: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
}
type Doc = Record<string, unknown> | null;
const body = ref<Doc>(null);
const atts = ref<Att[]>([]);
const error = ref('');
const editor = ref<InstanceType<typeof Editor> | null>(null);
const picker = ref<HTMLInputElement | null>(null);

// отказ сервера: отправленная строка откатится — покажем причину
const off = onMutationError((e) => {
  if (e.name === 'chat.message.send') error.value = tx('sendFailed', { m: e.message });
});
onBeforeUnmount(off);

let lastTyping = 0;
function onInput(v: Doc) {
  body.value = v;
  const now = Date.now();
  if (v && now - lastTyping >= 2000) {
    lastTyping = now;
    sendTyping('chatChannels', props.channelId);
  }
}

async function attach(files: File[]) {
  error.value = '';
  for (const f of files.slice(0, 10 - atts.value.length)) {
    try {
      const r = await uploadFile(f);
      atts.value = [
        ...atts.value,
        {
          fileSha256: r.sha256,
          name: f.name,
          mime: r.mime,
          size: r.size,
          ...(r.width != null && r.height != null ? { width: r.width, height: r.height } : {}),
        },
      ];
    } catch (e) {
      error.value = e instanceof ApiError && e.status === 413 ? tx('tooLarge') : tx('uploadFailed');
    }
  }
}
const filesOf = (l?: FileList | null) => [...(l ?? [])];

async function send() {
  if ((!body.value && !atts.value.length) || props.disabled) return;
  error.value = '';
  const id = newId();
  const doc = plain(body.value ?? { type: 'doc', content: [] });
  const attachments = plain(atts.value);
  body.value = null;
  atts.value = [];
  editor.value?.clear();
  await mutate('chat.message.send', {
    id,
    channelId: props.channelId,
    body: doc,
    readId: newId(),
    ...(props.parentId ? { parentId: props.parentId } : {}),
    attachments,
  }).catch((e: Error) => (error.value = tx('sendFailed', { m: e.message })));
  emit('sent', id);
}

// Enter отправляет (Shift+Enter — перенос); открытый список @ забирает Enter себе
function onEnter(e: KeyboardEvent) {
  if (e.isComposing || (e.currentTarget as HTMLElement).querySelector('[role=listbox]')) return;
  e.preventDefault();
  e.stopPropagation();
  void send();
}
</script>

<template>
  <div
    data-testid="chat-composer"
    class="border-t border-border p-2"
    @keydown.enter.exact.capture="onEnter"
    @drop.prevent="attach(filesOf($event.dataTransfer?.files))"
    @dragover.prevent
    @paste="attach(filesOf($event.clipboardData?.files))"
  >
    <p v-if="error" role="alert" class="mb-1 text-xs text-danger">{{ error }}</p>
    <p v-if="disabled" class="text-sm text-fg-muted">{{ tx('archived') }}</p>
    <template v-else>
      <ul v-if="atts.length" class="mb-1 flex flex-wrap gap-1">
        <li
          v-for="a in atts"
          :key="a.fileSha256"
          class="flex items-center gap-1 rounded-md bg-bg-muted px-2 py-0.5 text-xs"
        >
          {{ a.name }}
          <button
            type="button"
            :aria-label="tx('remove')"
            @click="atts = atts.filter((x) => x !== a)"
          >
            <X :size="12" />
          </button>
        </li>
      </ul>
      <div class="flex items-end gap-1">
        <button
          type="button"
          :aria-label="tx('attach')"
          class="rounded-md p-1.5 text-fg-muted hover:bg-bg-muted"
          @click="picker?.click()"
        >
          <Paperclip :size="18" />
        </button>
        <input
          ref="picker"
          type="file"
          multiple
          hidden
          data-testid="chat-file"
          @change="
            attach(filesOf(picker?.files));
            picker!.value = '';
          "
        />
        <div class="min-w-0 flex-1 rounded-md border border-border-strong px-2 py-1">
          <Editor
            ref="editor"
            :model-value="body"
            :members="members"
            :label="tx('message')"
            :placeholder="tx('placeholder')"
            @update:model-value="onInput"
            @submit="send"
          />
        </div>
        <Button variant="primary" :icon="Send" :aria-label="tx('send')" @click="send" />
      </div>
    </template>
  </div>
</template>
