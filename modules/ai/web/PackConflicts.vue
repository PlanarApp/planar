<script setup lang="ts">
import { tr } from './data';
import type { PackUpload } from './usePackUpload';

// Per-page choice for the conflicting pages of an upload (state lives in usePackUpload)
const props = defineProps<{ u: PackUpload; busy: boolean }>();
const { pending, choice, merged } = props.u;
</script>

<template>
  <div
    v-if="pending"
    class="flex flex-col gap-2 rounded-md border border-border p-3"
    data-testid="packs-conflicts"
  >
    <p class="text-sm">{{ tr('conflicts') }}</p>
    <div v-for="c in pending.conflicts" :key="c.key" class="flex flex-col gap-1 text-sm">
      <div class="flex flex-wrap items-center gap-3">
        <span class="font-medium">{{ c.title }}</span>
        <label
          v-for="o in ['reset', 'keep', 'merge'] as const"
          :key="o"
          class="flex items-center gap-1"
        >
          <input v-model="choice[c.key]" type="radio" :name="`c-${c.key}`" :value="o" />{{ tr(o) }}
        </label>
        <button
          v-if="choice[c.key] === 'merge'"
          type="button"
          class="underline"
          :disabled="busy"
          @click="u.merge(c)"
        >
          {{ tr('mergeRun') }}
        </button>
      </div>
      <textarea
        v-if="choice[c.key] === 'merge' && merged[c.key] !== undefined"
        v-model="merged[c.key]"
        rows="8"
        class="rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs"
      />
    </div>
    <div class="flex gap-3">
      <button
        type="button"
        :disabled="busy || !u.canResolve()"
        data-testid="packs-resolve"
        class="rounded-md border border-border px-3 py-1 disabled:opacity-50"
        @click="u.resolveAll()"
      >
        {{ tr('resolve') }}
      </button>
      <button type="button" class="underline" @click="u.pending.value = null">
        {{ tr('cancel') }}
      </button>
    </div>
  </div>
</template>
