<script setup lang="ts">
import { tr } from './data';
import { lineDiff } from './harnessUi';
import type { PackUpload } from './usePackUpload';

// PLNRAPP-538: the pages of an upload that differ from the pack — a choice per page with the diff, then the final
// texts and save (state lives in usePackUpload)
const props = defineProps<{ u: PackUpload; busy: boolean }>();
const { pending, step, choice, merged, warnings } = props.u;
const OPTIONS = ['keep', 'reset', 'merge'] as const;
const mark = { ' ': '', '-': 'bg-danger/10 text-danger', '+': 'bg-success/10 text-success' };
</script>

<template>
  <div
    v-if="pending"
    class="flex flex-col gap-3 rounded-md border border-border p-3 text-sm"
    data-testid="packs-review"
  >
    <template v-if="step === 'choose'">
      <p>{{ tr('reviewHint') }}</p>
      <ul v-if="pending.pages.some((p) => p.kind === 'new')" class="text-fg-muted">
        <li v-for="p in pending.pages.filter((x) => x.kind === 'new')" :key="p.key">
          {{ tr('pageNew') }}: {{ p.title }}
        </li>
      </ul>
      <div
        v-for="p in u.changed()"
        :key="p.key"
        class="flex flex-col gap-1"
        :data-testid="`packs-page-${p.key}`"
      >
        <div class="flex flex-wrap items-center gap-3">
          <span class="font-medium">{{ p.title }}</span>
          <span v-if="p.edited" class="rounded bg-bg-muted px-1.5 text-xs">{{
            tr('pageEdited')
          }}</span>
          <label v-for="o in OPTIONS" :key="o" class="flex items-center gap-1">
            <input v-model="choice[p.key]" type="radio" :name="`c-${p.key}`" :value="o" />{{
              tr(o)
            }}
          </label>
        </div>
        <details>
          <summary class="cursor-pointer text-fg-muted">{{ tr('pageDiff') }}</summary>
          <div class="overflow-x-auto">
            <pre
              class="font-mono text-xs"
            ><span v-for="(l, i) in lineDiff(p.current ?? '', p.incoming)" :key="i" :class="['block', mark[l.op]]">{{ l.op }} {{ l.text }}</span></pre>
          </div>
        </details>
      </div>
      <div class="flex gap-3">
        <button
          type="button"
          :disabled="busy"
          data-testid="packs-next"
          class="rounded-md border border-border px-3 py-1 disabled:opacity-50"
          @click="u.next()"
        >
          {{ tr('reviewNext') }}
        </button>
        <button type="button" class="underline" @click="u.cancel()">{{ tr('cancel') }}</button>
      </div>
    </template>

    <template v-else>
      <p>{{ tr('reviewFinal') }}</p>
      <ul v-if="warnings.length" class="text-danger" data-testid="packs-warnings">
        <li v-for="w in warnings" :key="w" role="alert">{{ w }}</li>
      </ul>
      <div v-for="p in u.changed()" :key="p.key" class="flex flex-col gap-1">
        <span class="font-medium">{{ p.title }} — {{ tr(choice[p.key]!) }}</span>
        <textarea
          v-if="choice[p.key] === 'merge'"
          v-model="merged[p.key]"
          rows="10"
          class="rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs"
          :data-testid="`packs-final-${p.key}`"
        />
        <textarea
          v-else
          :value="u.finalText(p)"
          readonly
          rows="6"
          class="rounded-md border border-border bg-bg-muted px-2 py-1 font-mono text-xs"
        />
      </div>
      <div class="flex gap-3">
        <button
          type="button"
          :disabled="busy"
          data-testid="packs-save"
          class="rounded-md border border-border px-3 py-1 disabled:opacity-50"
          @click="u.save()"
        >
          {{ tr('saveBtn') }}
        </button>
        <button type="button" class="underline" @click="u.back()">
          {{ tr('wzBack') }}
        </button>
        <button type="button" class="underline" @click="u.cancel()">{{ tr('cancel') }}</button>
      </div>
    </template>
  </div>
</template>
