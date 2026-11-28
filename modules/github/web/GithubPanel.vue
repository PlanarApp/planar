<script setup lang="ts">
import { computed, ref } from 'vue';
import { api, IconButton } from '@planar/web/modules';
import type { GithubCommit, GithubPr } from '../shared/index.js';
import { tr, useCommits, usePrs } from './data';
import { Commit, GithubIcon, Refresh } from './icons';

// PLNRAPP-892: the task's GitHub tab — PRs and commits of the bound repositories linked by the task key
const props = defineProps<{ taskId: string }>();
const prs = usePrs(() => props.taskId);
const commits = useCommits(() => props.taskId);

const busy = ref(false);
const err = ref('');
async function refresh() {
  busy.value = true;
  err.value = '';
  try {
    await api('POST', `/api/github/tasks/${props.taskId}/sync`);
  } catch (e) {
    err.value = (e as Error).message || tr('error');
  } finally {
    busy.value = false;
  }
}

const prList = computed(() =>
  [...(prs.value ?? [])].sort((a: GithubPr, b: GithubPr) =>
    b.prUpdatedAt.localeCompare(a.prUpdatedAt),
  ),
);
const commitList = computed(() =>
  [...(commits.value ?? [])].sort((a: GithubCommit, b: GithubCommit) =>
    b.committedAt.localeCompare(a.committedAt),
  ),
);
// only http(s): webUrl comes from an external system
const safe = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);
const tone = (state: string) =>
  state === 'merged'
    ? 'text-success'
    : state === 'open'
      ? 'text-accent'
      : state === 'closed'
        ? 'text-danger'
        : 'text-fg-subtle';
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="gh-panel">
    <div class="flex items-center gap-2">
      <IconButton
        class="ml-auto"
        size="sm"
        :icon="Refresh"
        :label="tr('refresh')"
        :disabled="busy"
        data-testid="gh-refresh"
        @click="refresh"
      />
    </div>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>

    <template v-if="prList.length">
      <h4 class="text-xs text-fg-muted">{{ tr('prs') }}</h4>
      <ul class="flex flex-col gap-2">
        <li
          v-for="p in prList"
          :key="p.id"
          class="flex min-w-0 flex-col gap-0.5 text-sm"
          data-testid="gh-pr"
        >
          <div class="flex min-w-0 items-center gap-2">
            <GithubIcon :size="14" :class="['shrink-0', tone(p.state)]" />
            <a
              :href="safe(p.webUrl)"
              target="_blank"
              rel="noopener noreferrer"
              class="min-w-0 truncate font-medium underline"
              data-testid="gh-pr-link"
              >#{{ p.number }} {{ p.title }}</a
            >
            <span
              :class="['shrink-0 rounded-full border border-current px-1.5 text-xs', tone(p.state)]"
              :data-state="p.state"
              data-testid="gh-pr-state"
              >{{ tr(p.state) }}</span
            >
          </div>
          <div class="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            <span class="min-w-0 truncate font-mono">{{ p.branch }}</span>
            <span v-if="p.authorLogin">{{ p.authorLogin }}</span>
            <span class="truncate">{{ p.repoFullName }}</span>
          </div>
        </li>
      </ul>
    </template>

    <template v-if="commitList.length">
      <h4 class="text-xs text-fg-muted">{{ tr('commits') }}</h4>
      <ul class="flex flex-col gap-2">
        <li
          v-for="c in commitList"
          :key="c.id"
          class="flex min-w-0 flex-wrap items-center gap-x-2 text-sm"
          data-testid="gh-commit"
        >
          <Commit :size="14" class="shrink-0 text-fg-muted" />
          <a
            :href="safe(c.webUrl)"
            target="_blank"
            rel="noopener noreferrer"
            class="shrink-0 font-mono underline"
            data-testid="gh-commit-sha"
            >{{ c.sha.slice(0, 7) }}</a
          >
          <span class="min-w-0 flex-1 truncate" data-testid="gh-commit-message">{{
            c.message
          }}</span>
          <span class="shrink-0 text-xs text-fg-muted" data-testid="gh-commit-author">{{
            c.authorName
          }}</span>
        </li>
      </ul>
    </template>
  </section>
</template>
