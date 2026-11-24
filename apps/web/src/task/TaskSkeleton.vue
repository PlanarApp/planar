<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// PLNRAPP-834: the task form while the task (or the form chunk) is loading — the same frame as TaskDetail
const { t } = useI18n();
const bar = 'animate-pulse rounded-md bg-bg-muted motion-reduce:animate-none';
</script>

<template>
  <div
    role="status"
    :aria-label="t('task.loading')"
    class="@container flex h-full w-full flex-col bg-bg"
    data-testid="task-skeleton"
  >
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <div :class="[bar, 'size-6']" />
      <div :class="[bar, 'h-4 w-48']" />
    </div>
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden @4xl:flex-row">
      <div class="flex min-w-0 flex-1 flex-col gap-6 px-4 py-5 @2xl:px-8">
        <div :class="[bar, 'h-8 w-2/3']" />
        <div class="flex flex-col gap-2">
          <div :class="[bar, 'h-4 w-full']" />
          <div :class="[bar, 'h-4 w-5/6']" />
          <div :class="[bar, 'h-4 w-1/2']" />
        </div>
        <div class="grid gap-x-10 gap-y-3 @2xl:grid-cols-2">
          <div v-for="i in 6" :key="i" class="flex h-6 items-center gap-4">
            <div :class="[bar, 'h-4 w-24 shrink-0']" />
            <div :class="[bar, 'h-4 flex-1']" />
          </div>
        </div>
      </div>
      <div
        class="flex shrink-0 flex-col gap-3 border-t border-border bg-bg-subtle p-4 @4xl:w-96 @4xl:border-t-0 @4xl:border-l"
      >
        <div v-for="i in 3" :key="i" :class="[bar, 'h-14']" />
      </div>
    </div>
  </div>
</template>
