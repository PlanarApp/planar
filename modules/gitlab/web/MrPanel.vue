<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, Button, IconButton, Select } from '@planar/web/modules';
import { tr, useMrs } from './data';
import { GitBranch, MergeRequest, Refresh } from './icons';

const props = defineProps<{ taskId: string }>();
const mrs = useMrs(() => props.taskId);
// PLNRAPP-153: the project's repositories, a branch / an MR by the task key, a poll now
const base = () => `/api/gitlab/tasks/${props.taskId}`;
const repos = ref<{ id: string; path: string }[]>([]);
const repo = ref<string | null>(null);
const busy = ref<'branch' | 'mr' | 'poll' | null>(null);
const err = ref('');
const made = ref('');
async function run(what: NonNullable<typeof busy.value>, f: () => Promise<unknown>) {
  busy.value = what;
  err.value = '';
  try {
    await f();
  } catch (e) {
    err.value = (e as Error).message || tr('error');
  } finally {
    busy.value = null;
  }
}
const make = (what: 'branch' | 'mr') =>
  run(what, async () => {
    const r = await api<{ webUrl: string }>('POST', `${base()}/${what}`, {
      connectionId: repo.value ?? undefined,
    });
    made.value = what === 'branch' ? r.webUrl : '';
  });
const poll = () => run('poll', () => api('POST', `${base()}/poll`));
onMounted(() =>
  api<{ repos: { id: string; path: string }[] }>('GET', `${base()}/repos`)
    .then((r) => {
      repos.value = r.repos;
      repo.value = r.repos[0]?.id ?? null;
    })
    .catch(() => {}),
);
const list = computed(() =>
  [...(mrs.value ?? [])].sort((a, b) => b.mrUpdatedAt.localeCompare(a.mrUpdatedAt)),
);
// only http(s): webUrl comes from an external system
const safe = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);
const tone = (state: string) =>
  state === 'merged' ? 'text-success' : state === 'opened' ? 'text-accent' : 'text-fg-subtle';
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="gl-panel">
    <div v-if="repos.length" class="flex flex-wrap items-center gap-2">
      <Select
        v-if="repos.length > 1"
        v-model="repo"
        size="sm"
        :label="tr('repoPick')"
        :options="repos.map((r) => ({ value: r.id, label: r.path }))"
      />
      <Button
        size="sm"
        variant="secondary"
        :icon="GitBranch"
        :loading="busy === 'branch'"
        :disabled="!!busy"
        data-testid="gl-new-branch"
        @click="make('branch')"
        >{{ tr('newBranch') }}</Button
      >
      <Button
        size="sm"
        variant="secondary"
        :icon="MergeRequest"
        :loading="busy === 'mr'"
        :disabled="!!busy"
        data-testid="gl-new-mr"
        @click="make('mr')"
        >{{ tr('newMr') }}</Button
      >
      <IconButton
        class="ml-auto"
        size="sm"
        :icon="Refresh"
        :label="tr('refresh')"
        :disabled="!!busy"
        data-testid="gl-poll"
        @click="poll"
      />
    </div>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
    <a
      v-if="made && safe(made)"
      :href="safe(made)"
      target="_blank"
      rel="noopener noreferrer"
      class="text-sm underline"
      data-testid="gl-branch-made"
      >{{ tr('branchMade') }}</a
    >
    <p v-if="!list.length" class="text-sm text-fg-muted">{{ tr('noMrs') }}</p>
    <ul v-else class="flex flex-col gap-2">
      <li v-for="m in list" :key="m.id" class="flex flex-col gap-0.5 text-sm" data-testid="gl-mr">
        <div class="flex items-center gap-2">
          <MergeRequest :size="14" :class="['shrink-0', tone(m.state)]" />
          <a
            :href="safe(m.webUrl)"
            target="_blank"
            rel="noopener noreferrer"
            class="min-w-0 truncate font-medium underline"
          >
            !{{ m.iid }} {{ m.title }}
          </a>
          <span :class="['text-xs', tone(m.state)]" :data-state="m.state" data-testid="gl-state">{{
            tr(m.state)
          }}</span>
        </div>
        <div class="flex items-center gap-2 text-xs text-fg-muted" data-testid="gl-branch">
          <GitBranch :size="14" :class="['shrink-0', tone(m.state)]" />
          <span class="min-w-0 truncate font-mono">{{ m.sourceBranch }}</span>
          <span :class="tone(m.state)">{{
            tr(m.state === 'merged' ? 'branchMerged' : 'branchOpen')
          }}</span>
        </div>
      </li>
    </ul>
  </section>
</template>
