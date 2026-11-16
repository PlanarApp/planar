<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import type { Filter, Row } from '@planar/shared';
import {
  AssigneePicker,
  Button,
  EmptyState,
  FilterBuilder,
  IconButton,
  Input,
  Menu,
  Select,
  StatusesPicker,
  db,
  newId,
  useLabels,
  useMembers,
  useQuery,
  useSpaces,
  useStatuses,
  useRouter,
} from '@planar/web/modules';
import {
  actionSchema,
  EMPTY_FILTER,
  PIPELINE_STATUSES,
  triggerSchema,
  type Action,
  type Rule,
  type Run,
  type Trigger,
} from '../shared/index.js';
import {
  ACTIONS,
  NUM_PARAM,
  TRIGGERS,
  blankAction,
  blankTrigger,
  fetchRuns,
  fetchSubscriptions,
  run,
  text,
  type HookSub,
} from './data';

const tx = computed(text);
const subs = ref<HookSub[]>([]);
onMounted(async () => (subs.value = await fetchSubscriptions().catch(() => [])));
const spaces = useSpaces();
const projects = computed(() => (spaces.value ?? []).flatMap((s) => s.projects));
// the selected project — in the address (?project=): after a reload, the rules of the same project are shown
const router = useRouter();
// without a router (page tests) — the selection is simply not remembered
const query = () => router?.currentRoute.value.query ?? {};
// projectId — settings of the project group: the project is set, no choice
const props = defineProps<{ projectId?: string }>();
const projectId = ref(
  props.projectId ?? (typeof query().project === 'string' ? (query().project as string) : ''),
);
watch(
  projects,
  (p) => {
    if (!p.length || props.projectId) return; // the replica is still loading — do not reset the selection from the address
    if (!projectId.value || !p.some((x) => x.id === projectId.value)) projectId.value = p[0]!.id;
  },
  { immediate: true },
);
watch(projectId, (id) => {
  if (id && !props.projectId && query().project !== id)
    void router?.replace({ query: { ...query(), project: id } });
});
const spaceId = computed(() => projects.value.find((p) => p.id === projectId.value)?.spaceId ?? '');
const statuses = useStatuses(spaceId);
const members = useMembers(spaceId);
const labels = useLabels(spaceId);

const rules = useQuery(() => db.table<Rule>('automationsRules').toArray());
const mine = computed(() => (rules.value ?? []).filter((r) => r.projectId === projectId.value));
// AI actions of the project (module ai, synced): the table is empty while the module is off
const allAi = useQuery(() =>
  db.table<{ id: string; projectId: string; name: string }>('aiActions').toArray(),
);
const aiActions = computed(() =>
  (allAi.value ?? []).filter((x) => x.projectId === projectId.value),
);

interface Draft {
  id: string;
  isNew: boolean;
  name: string;
  description: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Filter;
  actions: Action[];
}
const draft = ref<Draft | null>(null);
const error = ref('');
const runs = ref<{ ruleId: string; items: Run[] } | null>(null);

const startNew = () => {
  error.value = '';
  draft.value = {
    id: newId(),
    isNew: true,
    name: '',
    description: '',
    enabled: true,
    trigger: blankTrigger('task.created'),
    conditions: structuredClone(EMPTY_FILTER),
    actions: [blankAction('add_comment')],
  };
};
const edit = (r: Rule) => {
  error.value = '';
  draft.value = {
    id: r.id,
    isNew: false,
    name: r.name,
    description: r.description ?? '',
    enabled: r.enabled,
    trigger: structuredClone(r.trigger),
    conditions: structuredClone(r.conditions),
    actions: structuredClone(r.actions),
  };
};
const save = async () => {
  const d = draft.value!;
  const ok =
    d.name.trim() &&
    triggerSchema.safeParse(d.trigger).success &&
    d.actions.length > 0 &&
    d.actions.every((a) => actionSchema.safeParse(a).success);
  if (!ok) return void (error.value = tx.value.invalid);
  const body = {
    name: d.name.trim(),
    description: d.description.trim() || null,
    enabled: d.enabled,
    trigger: d.trigger,
    conditions: d.conditions,
    actions: d.actions,
  };
  await run(
    d.isNew ? 'automations.create' : 'automations.update',
    d.isNew ? { id: d.id, projectId: projectId.value, ...body } : { id: d.id, ...body },
  );
  draft.value = null;
};
const remove = (r: Rule) => run('automations.delete', { id: r.id });
const toggle = (r: Rule) => run('automations.update', { id: r.id, enabled: !r.enabled });
const showRuns = async (r: Rule) => {
  runs.value = { ruleId: r.id, items: await fetchRuns(r.id).catch(() => []) };
};

const setTriggerType = (type: Trigger['type']) => (draft.value!.trigger = blankTrigger(type));
const setActionType = (i: number, type: Action['type']) =>
  (draft.value!.actions[i] = blankAction(type));
const addAction = () => draft.value!.actions.push(blankAction('add_comment'));
const optional = (a: string[]) => (a.length ? a : undefined);
const MR_STATES = ['opened', 'merged'] as const;
const opts = (list: { v: string; l: string }[]) => list.map((o) => ({ value: o.v, label: o.l }));
const names = <T extends string>(list: readonly T[], dict: Record<string, string>) =>
  list.map((x) => ({ value: x, label: dict[x]! }));
const t = computed(() => draft.value!.trigger as Record<string, unknown>);
// a list of ids from the trigger (old rules may hold anything — only strings are taken)
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
// assignee_changed: userIds; a rule saved before PLNRAPP-197 holds a single userId
const triggerUsers = () => [...new Set([...ids(t.value.userIds), ...ids([t.value.userId])])];
const setTriggerUsers = (v: string[]) => {
  delete t.value.userId;
  t.value.userIds = optional(v);
};
const act = (a: Action) => a as Record<string, unknown>;
const projectName = (id: string) => projects.value.find((p) => p.id === id)?.name ?? id;
const pickers = computed(() => ({
  // statuses and labels belong to a project (PJ-1): the project of the rule
  statusId: (statuses.value ?? [])
    .filter((s) => s.projectId === projectId.value)
    .map((s) => ({ v: s.id, l: s.name })),
  userId: (members.value ?? []).map((u: Row<'users'>) => ({ v: u.id, l: u.name })),
  labelId: (labels.value ?? [])
    .filter((l) => l.projectId === projectId.value)
    .map((l) => ({ v: l.id, l: l.name })),
  projectId: projects.value.map((p) => ({ v: p.id, l: p.name })),
}));
const pickerKey = (a: Action) =>
  (['statusId', 'userId', 'labelId'] as const).find((k) => k in a) ??
  (a.type === 'move_to_project' ? 'projectId' : null);
const setValue = (i: number, raw: string) => {
  const a = draft.value!.actions[i] as Extract<Action, { type: 'set_field' }>;
  a.value = a.field === 'priority' ? Number(raw) : raw === '' ? null : raw;
};
</script>

<template>
  <section class="flex flex-col gap-4 p-4" data-testid="automations-page">
    <header class="flex flex-col gap-0.5">
      <h1 class="text-lg font-semibold">{{ tx.title }}</h1>
    </header>
    <div class="flex items-center gap-2 text-sm" data-role="project">
      {{ tx.project }}
      <Select
        v-if="!props.projectId"
        v-model="projectId"
        :label="tx.project"
        :options="opts(pickers.projectId)"
      />
    </div>

    <div v-if="!draft" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h2 class="font-medium">{{ tx.rules }}</h2>
        <Button variant="primary" size="sm" data-role="new" @click="startNew">{{ tx.add }}</Button>
      </div>
      <EmptyState v-if="!mine.length" :title="tx.none" />
      <ul class="flex flex-col divide-y divide-border">
        <li
          v-for="r in mine"
          :key="r.id"
          class="group flex min-h-8 flex-wrap items-center gap-2 py-1"
          data-role="rule"
        >
          <input
            type="checkbox"
            :checked="r.enabled"
            :aria-label="tx.enabled"
            @change="toggle(r)"
          />
          <span class="text-sm font-medium">{{ r.name }}</span>
          <span class="text-sm text-fg-muted">
            {{ tx.triggers[r.trigger.type] }} → {{ r.actions.length }}
          </span>
          <span v-if="r.description" class="basis-full text-sm text-fg-muted" data-role="desc">{{
            r.description
          }}</span>
          <span class="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" data-role="runs" @click="showRuns(r)">{{
              tx.log
            }}</Button>
            <Button size="sm" variant="ghost" data-role="edit" @click="edit(r)">{{
              tx.edit
            }}</Button>
            <Menu
              align="end"
              :label="tx.more"
              :items="[
                {
                  id: 'delete',
                  label: tx.delete,
                  danger: true,
                  confirm: {
                    title: tx.confirmDelete,
                    description: r.name,
                    confirmLabel: tx.delete,
                  },
                  onSelect: () => remove(r),
                },
              ]"
            />
          </span>
        </li>
      </ul>
      <div v-if="runs" data-testid="runs" class="flex flex-col gap-1">
        <h3 class="font-medium">{{ tx.log }}</h3>
        <p v-if="!runs.items.length" class="text-sm text-fg-muted">{{ tx.logEmpty }}</p>
        <ul class="text-sm">
          <li v-for="x in runs.items" :key="x.id" data-role="run">
            {{ new Date(x.createdAt).toLocaleString() }} · {{ tx.status[x.status] }}
            <span v-if="x.error" class="text-danger"> · {{ x.error }}</span>
          </li>
        </ul>
      </div>
    </div>

    <form v-else class="flex flex-col gap-4" data-testid="editor" @submit.prevent="save">
      <Input v-model="draft.name" :label="tx.name" maxlength="100" data-role="name" />
      <textarea
        v-model="draft.description"
        rows="2"
        maxlength="2000"
        :aria-label="tx.description"
        :placeholder="tx.description"
        class="rounded border border-border bg-transparent px-2 py-1 text-sm"
        data-role="description"
      />
      <label class="flex items-center gap-2 text-sm">
        <input v-model="draft.enabled" type="checkbox" /> {{ tx.enabled }}
      </label>

      <fieldset class="flex flex-col gap-2">
        <legend class="font-medium">{{ tx.trigger }}</legend>
        <div data-role="trigger">
          <Select
            :model-value="draft.trigger.type"
            :label="tx.trigger"
            :options="names(TRIGGERS, tx.triggers)"
            @update:model-value="(v) => setTriggerType(v as Trigger['type'])"
          />
        </div>
        <template v-if="draft.trigger.type === 'task.status_changed'">
          <div class="flex items-center gap-2 text-sm" data-role="from">
            {{ tx.from }}
            <StatusesPicker
              :space-id="spaceId"
              :project-id="projectId"
              :title="tx.from"
              :empty="tx.any"
              :model-value="ids(t.from)"
              @update:model-value="(v) => (t.from = optional(v))"
            />
          </div>
          <div class="flex items-center gap-2 text-sm" data-role="to">
            {{ tx.to }}
            <StatusesPicker
              :space-id="spaceId"
              :project-id="projectId"
              :title="tx.to"
              :empty="tx.any"
              :model-value="ids(t.to)"
              @update:model-value="(v) => (t.to = optional(v))"
            />
          </div>
        </template>
        <div
          v-if="draft.trigger.type === 'task.assignee_changed'"
          class="flex items-center gap-2 text-sm"
          data-role="users"
        >
          {{ tx.user }}
          <AssigneePicker
            :space-id="spaceId"
            :model-value="triggerUsers()"
            @update:model-value="setTriggerUsers"
          />
        </div>
        <Input
          v-if="draft.trigger.type === 'task.field_changed'"
          v-model="(t as Record<string, string>).field"
          :label="tx.field"
          data-role="trigger-field"
        />
        <Input
          v-if="draft.trigger.type === 'task.due'"
          :model-value="String((t as Record<string, number>).daysBefore ?? '')"
          type="number"
          min="0"
          max="30"
          :label="tx.daysBefore"
          :error="
            (t as Record<string, number | undefined>).daysBefore === undefined
              ? tx.invalid
              : undefined
          "
          data-role="days-before"
          @update:model-value="
            (v) =>
              ((t as Record<string, number | undefined>).daysBefore =
                v === '' ? undefined : Number(v))
          "
        />
        <Input
          v-if="NUM_PARAM[draft.trigger.type]"
          :model-value="String(t[NUM_PARAM[draft.trigger.type]!] ?? '')"
          type="number"
          min="1"
          :label="tx[NUM_PARAM[draft.trigger.type]!]"
          data-role="trigger-num"
          @update:model-value="
            (v) => (t[NUM_PARAM[draft!.trigger.type]!] = v === '' ? undefined : Number(v))
          "
        />
        <div
          v-if="draft.trigger.type === 'task.stale'"
          class="flex items-center gap-2 text-sm"
          data-role="statuses"
        >
          {{ tx.statuses }}
          <StatusesPicker
            :space-id="spaceId"
            :project-id="projectId"
            :title="tx.statuses"
            :empty="tx.any"
            :model-value="ids(t.statuses)"
            @update:model-value="(v) => (t.statuses = optional(v))"
          />
        </div>
        <template v-if="draft.trigger.type === 'schedule'">
          <Input v-model="(t as Record<string, string>).cron" :label="tx.cron" data-role="cron" />
          <Input
            :model-value="(t.tz as string) ?? ''"
            :label="tx.tz"
            placeholder="Europe/Moscow"
            data-role="tz"
            @update:model-value="(v) => (t.tz = v.trim() || undefined)"
          />
        </template>
        <template v-if="draft.trigger.type === 'mr.pipeline'">
          <div data-role="trigger-mr">
            <Select
              :model-value="t.mr as string"
              :label="tx.mr"
              :options="names(MR_STATES, tx.mrStates)"
              @update:model-value="(v) => (t.mr = v)"
            />
          </div>
          <div class="flex flex-wrap items-center gap-3 text-sm" data-role="trigger-pipeline">
            {{ tx.pipeline }}
            <label v-for="p in PIPELINE_STATUSES" :key="p" class="flex items-center gap-1">
              <input
                type="checkbox"
                :checked="ids(t.pipeline).includes(p)"
                @change="
                  t.pipeline = ($event.target as HTMLInputElement).checked
                    ? [...ids(t.pipeline), p]
                    : ids(t.pipeline).filter((x) => x !== p)
                "
              />
              {{ tx.pipelineStatuses[p] }}
            </label>
          </div>
        </template>
        <label
          v-if="
            draft.trigger.type === 'task.field_changed' || draft.trigger.type === 'comment.added'
          "
          class="flex items-center gap-2 text-sm"
        >
          <input
            :checked="!!t.byHuman"
            type="checkbox"
            data-role="by-human"
            @change="t.byHuman = ($event.target as HTMLInputElement).checked || undefined"
          />
          {{ tx.byHuman }}
        </label>
      </fieldset>

      <fieldset class="flex flex-col gap-2">
        <legend class="font-medium">{{ tx.conditions }}</legend>
        <FilterBuilder v-model="draft.conditions" :project-id="projectId" />
      </fieldset>

      <fieldset class="flex flex-col gap-2">
        <legend class="font-medium">{{ tx.actions }}</legend>
        <div
          v-for="(a, i) in draft.actions"
          :key="i"
          class="flex flex-wrap items-end gap-2"
          data-role="action"
        >
          <div data-role="action-type">
            <Select
              :model-value="a.type"
              :label="tx.actions"
              :options="names(ACTIONS, tx.actionNames)"
              @update:model-value="(v) => setActionType(i, v as Action['type'])"
            />
          </div>
          <div v-if="pickerKey(a)" data-role="action-param">
            <Select
              :model-value="(act(a)[pickerKey(a)!] as string) || null"
              :label="tx.value"
              :options="opts(pickers[pickerKey(a)!])"
              @update:model-value="(v) => (act(a)[pickerKey(a)!] = v ?? '')"
            />
          </div>
          <template v-if="a.type === 'set_field'">
            <Input v-model="a.field" :label="tx.field" />
            <Input
              :model-value="String(a.value ?? '')"
              :label="tx.value"
              data-role="action-value"
              @update:model-value="(v) => setValue(i, v)"
            />
          </template>
          <Input
            v-if="a.type === 'add_comment'"
            v-model="a.text"
            :label="tx.actionNames.add_comment"
            maxlength="5000"
            data-role="action-text"
          />
          <Input
            v-if="a.type === 'create_subtask'"
            v-model="a.title"
            :label="tx.actionNames.create_subtask"
            maxlength="500"
            data-role="action-text"
          />
          <template v-if="a.type === 'send_webhook'">
            <div v-if="subs.length" data-role="action-param">
              <Select
                :model-value="a.subscriptionId || null"
                :label="tx.subscription"
                :options="
                  subs.map((x) => ({
                    value: x.id,
                    label: x.description ? `${x.description} — ${x.url}` : x.url,
                  }))
                "
                @update:model-value="(v) => (a.subscriptionId = v ?? '')"
              />
            </div>
            <a v-else href="/settings/webhooks:webhooks" class="text-sm underline">{{
              tx.noSubscriptions
            }}</a>
          </template>
          <template v-if="a.type === 'ai_run'">
            <div v-if="aiActions.length" data-role="action-param">
              <Select
                :model-value="a.aiActionId || null"
                :label="tx.aiAction"
                :options="aiActions.map((x) => ({ value: x.id, label: x.name }))"
                @update:model-value="(v) => (a.aiActionId = v ?? '')"
              />
            </div>
            <span v-else class="text-sm text-fg-muted">{{ tx.noAiActions }}</span>
            <Input
              v-if="aiActions.length"
              :model-value="String(a.maxRuns ?? '')"
              type="number"
              min="1"
              max="20"
              :label="tx.maxRuns"
              data-role="max-runs"
              @update:model-value="(v) => (a.maxRuns = v === '' ? undefined : Number(v))"
            />
          </template>
          <IconButton :icon="X" :label="tx.delete" size="sm" @click="draft.actions.splice(i, 1)" />
        </div>
        <div>
          <Button
            size="sm"
            :disabled="draft.actions.length >= 10"
            data-role="add-action"
            @click="addAction"
            >{{ tx.addAction }}</Button
          >
        </div>
      </fieldset>

      <p v-if="error" class="text-sm text-danger" role="alert" data-role="error">{{ error }}</p>
      <div class="flex gap-2">
        <Button type="submit" variant="primary" data-role="save">{{ tx.save }}</Button>
        <Button data-role="cancel" @click="draft = null">{{ tx.cancel }}</Button>
      </div>
    </form>
  </section>
</template>
