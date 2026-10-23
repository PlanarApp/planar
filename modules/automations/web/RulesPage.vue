<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Filter, Row } from '@planar/shared';
import {
  Button,
  FilterBuilder,
  db,
  newId,
  useLabels,
  useMembers,
  useQuery,
  useSpaces,
  useStatuses,
} from '@planar/web/modules';
import {
  actionSchema,
  EMPTY_FILTER,
  triggerSchema,
  type Action,
  type Rule,
  type Run,
  type Trigger,
} from '../shared/index.js';
import { ACTIONS, TRIGGERS, blankAction, blankTrigger, fetchRuns, run, text } from './data';

const tx = computed(text);
const spaces = useSpaces();
const projects = computed(() => (spaces.value ?? []).flatMap((s) => s.projects));
const projectId = ref('');
watch(
  projects,
  (p) => {
    if (!projectId.value || !p.some((x) => x.id === projectId.value))
      projectId.value = p[0]?.id ?? '';
  },
  { immediate: true },
);
const spaceId = computed(() => projects.value.find((p) => p.id === projectId.value)?.spaceId ?? '');
const statuses = useStatuses(spaceId);
const members = useMembers(spaceId);
const labels = useLabels(spaceId);

const rules = useQuery(() => db.table<Rule>('automationsRules').toArray());
const mine = computed(() => (rules.value ?? []).filter((r) => r.projectId === projectId.value));

interface Draft {
  id: string;
  isNew: boolean;
  name: string;
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
const csv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const optional = (a: string[]) => (a.length ? a : undefined);
const field = 'h-11 rounded-md border border-border-strong bg-bg px-2 text-base md:h-8';
const t = computed(() => draft.value!.trigger as Record<string, unknown>);
const act = (a: Action) => a as Record<string, unknown>;
const projectName = (id: string) => projects.value.find((p) => p.id === id)?.name ?? id;
const pickers = computed(() => ({
  statusId: (statuses.value ?? []).map((s) => ({ v: s.id, l: s.name })),
  userId: (members.value ?? []).map((u: Row<'users'>) => ({ v: u.id, l: u.name })),
  labelId: (labels.value ?? []).map((l) => ({ v: l.id, l: l.name })),
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
    <h1 class="text-xl font-semibold">{{ tx.title }}</h1>
    <label class="flex items-center gap-2 text-sm">
      {{ tx.project }}
      <select v-model="projectId" :class="field" data-role="project">
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </label>

    <div v-if="!draft" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h2 class="font-medium">{{ tx.rules }}</h2>
        <Button variant="primary" size="sm" data-role="new" @click="startNew">{{ tx.add }}</Button>
      </div>
      <p v-if="!mine.length" class="text-sm text-fg-muted">{{ tx.none }}</p>
      <ul class="flex flex-col gap-2">
        <li
          v-for="r in mine"
          :key="r.id"
          class="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
          data-role="rule"
        >
          <input
            type="checkbox"
            :checked="r.enabled"
            :aria-label="tx.enabled"
            @change="toggle(r)"
          />
          <span class="font-medium">{{ r.name }}</span>
          <span class="text-sm text-fg-muted">
            {{ tx.triggers[r.trigger.type] }} → {{ r.actions.length }}
          </span>
          <span class="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" data-role="runs" @click="showRuns(r)">{{
              tx.log
            }}</Button>
            <Button size="sm" variant="ghost" data-role="edit" @click="edit(r)">{{
              tx.edit
            }}</Button>
            <Button size="sm" variant="ghost" data-role="delete" @click="remove(r)">{{
              tx.delete
            }}</Button>
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
      <label class="flex flex-col gap-1 text-sm">
        {{ tx.name }}
        <input v-model="draft.name" maxlength="100" :class="field" data-role="name" />
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input v-model="draft.enabled" type="checkbox" /> {{ tx.enabled }}
      </label>

      <fieldset class="flex flex-col gap-2">
        <legend class="font-medium">{{ tx.trigger }}</legend>
        <select
          :value="draft.trigger.type"
          :class="field"
          data-role="trigger"
          @change="setTriggerType(($event.target as HTMLSelectElement).value as Trigger['type'])"
        >
          <option v-for="x in TRIGGERS" :key="x" :value="x">{{ tx.triggers[x] }}</option>
        </select>
        <template v-if="draft.trigger.type === 'task.status_changed'">
          <input
            :value="((t.from as string[]) ?? []).join(', ')"
            :placeholder="tx.from"
            :aria-label="tx.from"
            :class="field"
            @input="t.from = optional(csv(($event.target as HTMLInputElement).value))"
          />
          <input
            :value="((t.to as string[]) ?? []).join(', ')"
            :placeholder="tx.to"
            :aria-label="tx.to"
            :class="field"
            @input="t.to = optional(csv(($event.target as HTMLInputElement).value))"
          />
        </template>
        <select
          v-if="draft.trigger.type === 'task.assignee_changed'"
          :value="t.userId ?? ''"
          :aria-label="tx.user"
          :class="field"
          @change="t.userId = ($event.target as HTMLSelectElement).value || undefined"
        >
          <option value="">—</option>
          <option v-for="u in pickers.userId" :key="u.v" :value="u.v">{{ u.l }}</option>
        </select>
        <input
          v-if="draft.trigger.type === 'task.field_changed'"
          v-model="(t as Record<string, string>).field"
          :aria-label="tx.field"
          :class="field"
          data-role="trigger-field"
        />
        <label v-if="draft.trigger.type === 'task.due'" class="flex items-center gap-2 text-sm">
          {{ tx.daysBefore }}
          <input
            v-model.number="(t as Record<string, number>).daysBefore"
            type="number"
            min="0"
            max="30"
            :class="field"
            data-role="days-before"
          />
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
          class="flex flex-wrap items-center gap-2"
          data-role="action"
        >
          <select
            :value="a.type"
            :class="field"
            data-role="action-type"
            @change="setActionType(i, ($event.target as HTMLSelectElement).value as Action['type'])"
          >
            <option v-for="x in ACTIONS" :key="x" :value="x">{{ tx.actionNames[x] }}</option>
          </select>
          <select
            v-if="pickerKey(a)"
            :value="act(a)[pickerKey(a)!]"
            :class="field"
            data-role="action-param"
            @change="act(a)[pickerKey(a)!] = ($event.target as HTMLSelectElement).value"
          >
            <option value="" disabled></option>
            <option v-for="o in pickers[pickerKey(a)!]" :key="o.v" :value="o.v">{{ o.l }}</option>
          </select>
          <template v-if="a.type === 'set_field'">
            <input v-model="a.field" :aria-label="tx.field" :class="field" />
            <input
              :value="a.value ?? ''"
              :aria-label="tx.value"
              :class="field"
              data-role="action-value"
              @input="setValue(i, ($event.target as HTMLInputElement).value)"
            />
          </template>
          <input
            v-if="a.type === 'add_comment'"
            v-model="a.text"
            maxlength="5000"
            :class="field"
            data-role="action-text"
          />
          <input
            v-if="a.type === 'create_subtask'"
            v-model="a.title"
            maxlength="500"
            :class="field"
            data-role="action-text"
          />
          <input
            v-if="a.type === 'send_webhook'"
            v-model="a.subscriptionId"
            :aria-label="tx.subscription"
            :placeholder="tx.subscription"
            :class="field"
            data-role="action-text"
          />
          <Button
            size="sm"
            variant="ghost"
            :aria-label="tx.delete"
            @click="draft.actions.splice(i, 1)"
            >×</Button
          >
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
