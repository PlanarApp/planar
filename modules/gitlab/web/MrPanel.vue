<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, Button, Dialog, IconButton, Input, Select } from '@planar/web/modules';
import { gitRefError } from '../shared/branch-name.js';
import type { GitlabMr } from '../shared/index.js';
import CiStatus from './CiStatus.vue';
import { tr, useBranches, useMrs } from './data';
import { GitBranch, MergeRequest, Refresh } from './icons';

const props = defineProps<{ taskId: string }>();
const mrs = useMrs(() => props.taskId);
const branches = useBranches(() => props.taskId);
// PLNRAPP-153: the project's repositories, a branch by the template, an MR from a branch, a poll now
const base = () => `/api/gitlab/tasks/${props.taskId}`;
const repos = ref<{ id: string; path: string }[]>([]);
const busy = ref<string | null>(null);
const err = ref('');
async function run(what: string, f: () => Promise<unknown>) {
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
const poll = () => run('poll', () => api('POST', `${base()}/poll`));
const makeMr = (branchId: string) =>
  run(`mr:${branchId}`, () => api('POST', `${base()}/mr`, { branchId }));
onMounted(() =>
  api<{ repos: { id: string; path: string }[] }>('GET', `${base()}/repos`)
    .then((r) => (repos.value = r.repos))
    .catch(() => {}),
);

// the «Create branch» dialog: the name by the project's template, editable; the repository — if several
const dialog = ref(false);
const name = ref('');
const repo = ref<string | null>(null);
const dialogErr = ref('');
const nameErr = computed(() => (name.value.trim() ? gitRefError(name.value.trim()) : null));
async function openDialog() {
  dialogErr.value = '';
  repo.value = repos.value[0]?.id ?? null;
  name.value = '';
  dialog.value = true;
  try {
    name.value = (await api<{ name: string }>('GET', `${base()}/branch-name`)).name;
  } catch (e) {
    dialogErr.value = (e as Error).message || tr('error');
  }
}
async function createBranch() {
  if (!name.value.trim() || nameErr.value) return;
  busy.value = 'branch';
  dialogErr.value = '';
  try {
    await api('POST', `${base()}/branch`, {
      name: name.value.trim(),
      connectionId: repo.value ?? undefined,
    });
    dialog.value = false;
  } catch (e) {
    dialogErr.value = (e as Error).message || tr('error');
  } finally {
    busy.value = null;
  }
}

const byDate = (a: GitlabMr, b: GitlabMr) => b.mrUpdatedAt.localeCompare(a.mrUpdatedAt);
const at = (gitlabProjectId: number, branch: string) => `${gitlabProjectId}:${branch}`;
// MRs under their branch (by source_branch in the same repository); MRs of other branches — separately
const groups = computed(() => {
  const list = [...(mrs.value ?? [])].sort(byDate);
  const bs = [...(branches.value ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const known = new Set(bs.map((b) => at(b.gitlabProjectId, b.name)));
  return {
    branches: bs.map((b) => {
      const own = list.filter(
        (m) => at(m.gitlabProjectId, m.sourceBranch) === at(b.gitlabProjectId, b.name),
      );
      return { b, mrs: own, canMr: !own.some((m) => m.state === 'opened') };
    }),
    other: list.filter((m) => !known.has(at(m.gitlabProjectId, m.sourceBranch))),
  };
});
const empty = computed(() => !groups.value.branches.length && !groups.value.other.length);
// only http(s): webUrl comes from an external system
const safe = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);
const tone = (state: string) =>
  state === 'merged' ? 'text-success' : state === 'opened' ? 'text-accent' : 'text-fg-subtle';
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="gl-panel">
    <div v-if="repos.length" class="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        :icon="GitBranch"
        :disabled="!!busy"
        data-testid="gl-new-branch"
        @click="openDialog"
        >{{ tr('newBranch') }}</Button
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
    <p v-if="empty" class="text-sm text-fg-muted">{{ tr('noMrs') }}</p>

    <ul v-if="groups.branches.length" class="flex flex-col gap-3">
      <li
        v-for="g in groups.branches"
        :key="g.b.id"
        class="flex flex-col gap-1 text-sm"
        data-testid="gl-branch-group"
      >
        <div class="flex items-center gap-2">
          <GitBranch :size="14" class="shrink-0 text-fg-muted" />
          <a
            :href="safe(g.b.webUrl)"
            target="_blank"
            rel="noopener noreferrer"
            class="min-w-0 truncate font-mono underline"
            data-testid="gl-branch-name"
            >{{ g.b.name }}</a
          >
          <CiStatus v-if="g.b.pipelineStatus" :status="g.b.pipelineStatus" :url="g.b.pipelineUrl" />
          <Button
            v-if="repos.length && g.canMr"
            class="ml-auto"
            size="sm"
            variant="ghost"
            :icon="MergeRequest"
            :loading="busy === `mr:${g.b.id}`"
            :disabled="!!busy"
            data-testid="gl-new-mr"
            @click="makeMr(g.b.id)"
            >{{ tr('newMr') }}</Button
          >
        </div>
        <ul v-if="g.mrs.length" class="ml-5 flex flex-col gap-1">
          <li v-for="m in g.mrs" :key="m.id" class="flex items-center gap-2" data-testid="gl-mr">
            <MergeRequest :size="14" :class="['shrink-0', tone(m.state)]" />
            <a
              :href="safe(m.webUrl)"
              target="_blank"
              rel="noopener noreferrer"
              class="min-w-0 truncate font-medium underline"
            >
              !{{ m.iid }} {{ m.title }}
            </a>
            <span
              :class="['text-xs', tone(m.state)]"
              :data-state="m.state"
              data-testid="gl-state"
              >{{ tr(m.state) }}</span
            >
          </li>
        </ul>
      </li>
    </ul>

    <template v-if="groups.other.length">
      <h4 v-if="groups.branches.length" class="text-xs text-fg-muted" data-testid="gl-other">
        {{ tr('otherMrs') }}
      </h4>
      <ul class="flex flex-col gap-2">
        <li
          v-for="m in groups.other"
          :key="m.id"
          class="flex flex-col gap-0.5 text-sm"
          data-testid="gl-mr"
        >
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
            <span
              :class="['text-xs', tone(m.state)]"
              :data-state="m.state"
              data-testid="gl-state"
              >{{ tr(m.state) }}</span
            >
          </div>
          <div class="flex items-center gap-2 text-xs text-fg-muted" data-testid="gl-branch">
            <GitBranch :size="14" :class="['shrink-0', tone(m.state)]" />
            <span class="min-w-0 truncate font-mono">{{ m.sourceBranch }}</span>
            <span :class="tone(m.state)">{{
              tr(m.state === 'merged' ? 'branchMerged' : 'branchOpen')
            }}</span>
            <!-- PLNRAPP-822: the branch of an open MR — its head pipeline -->
            <CiStatus
              v-if="m.state === 'opened' && m.pipelineStatus"
              :status="m.pipelineStatus"
              :url="m.pipelineUrl"
            />
          </div>
        </li>
      </ul>
    </template>

    <Dialog v-model:open="dialog" :title="tr('newBranch')" size="sm">
      <form class="flex flex-col gap-3" data-testid="gl-branch-form" @submit.prevent="createBranch">
        <Select
          v-if="repos.length > 1"
          v-model="repo"
          :label="tr('repoPick')"
          :options="repos.map((r) => ({ value: r.id, label: r.path }))"
          data-testid="gl-repo"
        />
        <Input
          v-model="name"
          :label="tr('branchName')"
          :error="nameErr ?? undefined"
          autocomplete="off"
          data-testid="gl-branch-input"
        />
        <p v-if="dialogErr" role="alert" class="text-sm text-danger" data-testid="gl-dialog-err">
          {{ dialogErr }}
        </p>
      </form>
      <template #footer>
        <Button @click="dialog = false">{{ tr('cancel') }}</Button>
        <Button
          variant="primary"
          :loading="busy === 'branch'"
          :disabled="!name.trim() || !!nameErr || !!busy"
          data-testid="gl-branch-create"
          @click="createBranch"
          >{{ tr('create') }}</Button
        >
      </template>
    </Dialog>
  </section>
</template>
