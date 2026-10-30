<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, ref } from 'vue';
import { Mic, Paperclip, Send, Smile, X } from 'lucide-vue-next';
import {
  ApiError,
  Button,
  Editor,
  IconButton,
  Popover,
  mutate,
  newId,
  onMutationError,
  sendTyping,
  uploadFile,
} from '@planar/web/modules';
import { plain } from './model';
import { useTexts } from './text';

const EmojiPicker = defineAsyncComponent(() => import('./EmojiPicker.vue'));

const props = defineProps<{
  channelId: string;
  parentId?: string;
  members: { id: string; name: string }[];
  disabled?: boolean;
}>();
const emit = defineEmits<{ sent: [id: string]; editLast: [] }>();
const tx = useTexts();

interface Att {
  fileSha256: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
}
type Doc = Record<string, unknown> | null;
const body = ref<Doc>(null);
const atts = ref<Att[]>([]);
const error = ref('');
const editor = ref<InstanceType<typeof Editor> | null>(null);
const emojiOpen = ref(false);
function insertEmoji(e: string) {
  emojiOpen.value = false;
  editor.value?.editor?.chain().focus().insertContent(e).run();
}
const picker = ref<HTMLInputElement | null>(null);

// голосовое: MediaRecorder (webm/opus, в Safari — mp4), не дольше 5 минут; уходит вложением audio/*
const MAX_VOICE_MS = 5 * 60_000;
const canRecord = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
const rec = ref<{ mr: MediaRecorder; startedAt: number } | null>(null);
const recMs = ref(0);
let recTimer: ReturnType<typeof setInterval> | undefined;
let chunks: Blob[] = [];
let keep = false;
async function startVoice() {
  error.value = '';
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    error.value = tx('micDenied');
    return;
  }
  const type = ['audio/webm;codecs=opus', 'audio/mp4'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  chunks = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(recTimer);
    const ms = Date.now() - (rec.value?.startedAt ?? Date.now());
    rec.value = null;
    if (keep) void sendVoice(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }), ms);
  };
  rec.value = { mr, startedAt: Date.now() };
  recMs.value = 0;
  recTimer = setInterval(() => {
    recMs.value = Date.now() - rec.value!.startedAt;
    if (recMs.value >= MAX_VOICE_MS) stopVoice(true);
  }, 250);
  mr.start();
}
function stopVoice(send: boolean) {
  keep = send;
  if (rec.value?.mr.state === 'recording') rec.value.mr.stop();
}
async function sendVoice(blob: Blob, durationMs: number) {
  const mime = blob.type.split(';')[0]!;
  const name = `voice-${new Date().toISOString().slice(0, 19)}.${mime === 'audio/mp4' ? 'm4a' : 'webm'}`;
  try {
    const r = await uploadFile(new File([blob], name, { type: mime }));
    atts.value = [
      ...atts.value,
      { fileSha256: r.sha256, name, mime: r.mime, size: r.size, durationMs },
    ];
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 413 ? tx('tooLarge') : tx('uploadFailed');
    return;
  }
  await send();
}
onBeforeUnmount(() => stopVoice(false));
const clock = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

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
  // запись в IndexedDB стартует до очистки редактора: они идут параллельно
  const sending = mutate('chat.message.send', {
    id,
    channelId: props.channelId,
    body: doc,
    readId: newId(),
    ...(props.parentId ? { parentId: props.parentId } : {}),
    attachments,
  }).catch((e: Error) => (error.value = tx('sendFailed', { m: e.message })));
  body.value = null;
  atts.value = [];
  editor.value?.clear();
  await sending;
  emit('sent', id);
}

// ↑ в пустом поле — править своё последнее сообщение, как в Slack
function onUp(e: KeyboardEvent) {
  if (
    body.value ||
    atts.value.length ||
    (e.currentTarget as HTMLElement).querySelector('[role=listbox]')
  )
    return;
  e.preventDefault();
  emit('editLast');
}
defineExpose({ focus: () => editor.value?.focus() });

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
    @keydown.up.exact="onUp"
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
          <IconButton
            :icon="X"
            :label="tx('remove')"
            size="sm"
            @click="atts = atts.filter((x) => x !== a)"
          />
        </li>
      </ul>
      <div class="flex items-end gap-1">
        <IconButton :icon="Paperclip" :label="tx('attach')" @click="picker?.click()" />
        <Popover v-model:open="emojiOpen" side="top" align="start">
          <template #trigger>
            <IconButton :icon="Smile" :label="tx('emoji')" data-testid="chat-emoji" />
          </template>
          <EmojiPicker v-if="emojiOpen" @pick="insertEmoji" />
        </Popover>
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
        <div
          v-if="rec"
          role="status"
          data-testid="chat-recording"
          class="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-danger px-2 text-sm"
        >
          <span class="size-2 animate-pulse rounded-full bg-danger" aria-hidden="true" />
          {{ tx('recording') }} {{ clock(recMs) }}
          <Button size="sm" variant="ghost" class="ml-auto" @click="stopVoice(false)">{{
            tx('cancel')
          }}</Button>
        </div>
        <div v-show="!rec" class="min-w-0 flex-1 rounded-md border border-border-strong px-2 py-1">
          <Editor
            ref="editor"
            :model-value="body"
            :members="members"
            refs
            :label="tx('message')"
            :placeholder="tx('placeholder')"
            @update:model-value="onInput"
            @submit="send"
          />
        </div>
        <IconButton
          v-if="canRecord && !rec"
          :icon="Mic"
          :label="tx('voice')"
          data-testid="chat-voice"
          @click="startVoice"
        />
        <Button
          v-if="rec"
          variant="primary"
          :icon="Send"
          :aria-label="tx('send')"
          data-testid="chat-voice-send"
          @click="stopVoice(true)"
        />
        <Button v-else variant="primary" :icon="Send" :aria-label="tx('send')" @click="send" />
      </div>
    </template>
  </div>
</template>
