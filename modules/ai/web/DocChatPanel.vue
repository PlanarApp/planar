<script setup lang="ts">
import { computed, ref } from 'vue';
import { Button } from '@planar/web/modules';
import { AiApiError, call } from './api';
import { tr } from './data';
import {
  applyFailure,
  diffPrefix,
  hasChanges,
  trimHistory,
  type ChatMsg,
  type ChatReply,
  type Proposal,
} from './docChatUi';

// Panel under the title of any document (docPanels): chat → diff of the proposed edit → accept / reject
const props = defineProps<{ pageId: string; projectId?: string | null }>();
const open = ref(false);
const msgs = ref<ChatMsg[]>([]);
const text = ref('');
const proposal = ref<Proposal | null>(null);
const error = ref('');
const stale = ref(false);
const done = ref(false);
const busy = ref(false);
const lastAsk = ref('');

async function ask(message: string) {
  if (!message.trim() || busy.value) return;
  busy.value = true;
  error.value = '';
  stale.value = false;
  done.value = false;
  lastAsk.value = message;
  const history = trimHistory(msgs.value);
  msgs.value.push({ role: 'user', text: message });
  text.value = '';
  try {
    const r = await call<ChatReply>('POST', 'doc-chat', { pageId: props.pageId, message, history });
    msgs.value.push({ role: 'assistant', text: r.reply });
    proposal.value = hasChanges(r.proposal) ? r.proposal : null;
  } catch (e) {
    error.value =
      e instanceof AiApiError && e.status === 403 ? tr('forbidden') : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function accept() {
  const p = proposal.value;
  if (!p) return;
  busy.value = true;
  error.value = '';
  try {
    await call('POST', 'doc-chat/apply', {
      pageId: props.pageId,
      body: p.body,
      baseUpdatedAt: p.baseUpdatedAt,
    });
    proposal.value = null;
    done.value = true;
  } catch (e) {
    const k = applyFailure(e instanceof AiApiError ? e.status : undefined);
    if (k === 'changed') stale.value = true;
    error.value =
      k === 'changed'
        ? tr('docChanged')
        : k === 'forbidden'
          ? tr('forbidden')
          : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const reject = () => {
  proposal.value = null;
  stale.value = false;
  error.value = '';
};
const cls = (t: string) =>
  t === 'add' ? 'bg-success/10' : t === 'del' ? 'bg-danger/10 line-through' : 'text-fg-muted';
const canSend = computed(() => !!text.value.trim() && !busy.value);
</script>

<template>
  <div v-if="projectId" class="flex flex-col gap-2" data-testid="docchat-panel">
    <div class="flex items-center gap-3">
      <Button size="sm" data-testid="docchat-toggle" @click="open = !open">{{
        tr('chatTitle')
      }}</Button>
      <span v-if="done" class="text-sm text-fg-muted" data-testid="docchat-done">{{
        tr('accepted')
      }}</span>
    </div>
    <div v-if="open" class="flex flex-col gap-2 rounded-md border border-border p-3">
      <ul class="flex flex-col gap-1 text-sm" data-testid="docchat-msgs">
        <li v-for="(m, i) in msgs" :key="i" :class="m.role === 'user' ? 'font-medium' : ''">
          {{ m.text }}
        </li>
      </ul>
      <div
        v-if="proposal"
        class="max-h-80 overflow-auto rounded-md border border-border p-2 font-mono text-xs"
        data-testid="docchat-diff"
      >
        <div v-for="(l, i) in proposal.diff" :key="i" :class="['whitespace-pre-wrap', cls(l.type)]">
          {{ diffPrefix(l.type) }} {{ l.text }}
        </div>
      </div>
      <div v-if="proposal" class="flex gap-2">
        <Button size="sm" :disabled="busy || stale" data-testid="docchat-accept" @click="accept">{{
          tr('accept')
        }}</Button>
        <Button size="sm" data-testid="docchat-reject" @click="reject">{{ tr('reject') }}</Button>
        <Button v-if="stale" size="sm" data-testid="docchat-rerequest" @click="ask(lastAsk)">{{
          tr('reRequest')
        }}</Button>
      </div>
      <p v-if="error" role="alert" class="text-sm text-danger" data-testid="docchat-error">
        {{ error }}
      </p>
      <form class="flex gap-2" @submit.prevent="ask(text)">
        <input
          v-model="text"
          :placeholder="tr('chatPlaceholder')"
          data-testid="docchat-input"
          class="flex-1 rounded-md border border-border bg-bg px-2 py-1"
        />
        <Button size="sm" type="submit" :disabled="!canSend" data-testid="docchat-send">{{
          tr('send')
        }}</Button>
      </form>
    </div>
  </div>
</template>
