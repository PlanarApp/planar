<script setup lang="ts">
import { computed, reactive, ref, toRaw, watch } from 'vue';
import type { Row } from '@planar/shared';
import { db, mutate, newId, useQuery, useRouter, useSession } from '@planar/web/modules';
import type { FormField, FormsForm } from '../shared/index.js';
import { genSlug } from './slug';

const ru = !/^en/i.test(document.documentElement.lang || navigator.language || 'ru');
const L = ru
  ? {
      title: 'Формы',
      project: 'Проект',
      status: 'Статус новых задач',
      name: 'Название формы',
      create: 'Создать форму',
      link: 'Ссылка',
      copy: 'Копировать',
      on: 'Принимает ответы',
      del: 'Удалить',
      save: 'Сохранить',
      desc: 'Описание',
      fields: 'Поля',
      req: 'обязательное',
      none: 'Форм нет',
      title0: 'Заголовок',
      description: 'Описание задачи',
      email: 'E-mail',
      files: 'Файлы',
      personal: 'Персональная ссылка: ответ комментарием в задачу',
      task: 'Ключ задачи, например PRJ-12',
      days: 'Дней',
      once: 'Одноразовая',
      issue: 'Создать ссылку',
      shown: 'Ссылка показана один раз, скопируйте её сейчас:',
    }
  : {
      title: 'Forms',
      project: 'Project',
      status: 'Status of new tasks',
      name: 'Form name',
      create: 'Create form',
      link: 'Link',
      copy: 'Copy',
      on: 'Accepting responses',
      del: 'Delete',
      save: 'Save',
      desc: 'Description',
      fields: 'Fields',
      req: 'required',
      none: 'No forms',
      title0: 'Title',
      description: 'Task description',
      email: 'E-mail',
      files: 'Files',
      personal: 'Personal link: the answer goes into a task as a comment',
      task: 'Task key, e.g. PRJ-12',
      days: 'Days',
      once: 'Single use',
      issue: 'Create link',
      shown: 'The link is shown once, copy it now:',
    };

const session = useSession();
// the server checks rights anyway (write: admin)
const admin = computed(() => ['owner', 'admin'].includes(session.value?.role ?? ''));

const projects = useQuery(async () =>
  (await db.table<Row<'projects'>>('projects').toArray()).filter((p) => !p.archivedAt),
);
// the selected project — in the address (?project=): after a reload, the same
const router = useRouter();
// without a router (page tests) — the selection is simply not remembered
const query = () => router?.currentRoute.value.query ?? {};
// projectId — settings of a group project: the project is set, there is no choice
const props = defineProps<{ projectId?: string }>();
const projectId = ref(
  props.projectId ?? (typeof query().project === 'string' ? (query().project as string) : ''),
);
watch(
  projects,
  (p) => {
    if (!p?.length || props.projectId) return;
    if (!p.some((x) => x.id === projectId.value)) projectId.value = p[0]!.id;
  },
  { immediate: true },
);
watch(projectId, (id) => {
  if (id && !props.projectId && query().project !== id)
    void router?.replace({ query: { ...query(), project: id } });
});
const project = computed(() => projects.value?.find((p) => p.id === projectId.value));

// liveQuery does not watch a Vue ref: read everything and filter in computed
const allForms = useQuery(() => db.table('formsForms').toArray() as Promise<FormsForm[]>);
const allDefs = useQuery(() => db.table<Row<'fieldDefs'>>('fieldDefs').toArray());
const allStatuses = useQuery(() => db.table<Row<'statuses'>>('statuses').toArray());
const forms = computed(() => allForms.value?.filter((f) => f.projectId === projectId.value));
const defs = computed(() => allDefs.value?.filter((d) => d.projectId === projectId.value));
const statuses = computed(() => allStatuses.value?.filter((s) => s.projectId === projectId.value));

// available keys of the form fields
const catalog = computed(() => [
  { key: 'title', label: L.title0 },
  { key: 'description', label: L.description },
  { key: 'email', label: L.email },
  { key: 'files', label: L.files },
  // a user field cannot be filled on the public page
  ...(defs.value ?? [])
    .filter((d) => d.type !== 'user')
    .map((d) => ({ key: `field:${d.id}`, label: d.name })),
]);

// builder drafts: formId → fields
const draft = reactive<Record<string, FormField[]>>({});
const fieldsOf = (f: FormsForm) => (draft[f.id] ??= structuredClone(f.fields as FormField[]));
const find = (f: FormsForm, key: string) => fieldsOf(f).find((x) => x.key === key);
function toggle(f: FormsForm, key: string, label: string, on: boolean) {
  const fs = fieldsOf(f);
  if (on && !find(f, key)) fs.push({ key, label, required: false });
  if (!on) draft[f.id] = fs.filter((x) => x.key !== key);
}

const run = (name: string, args: Record<string, unknown>) => mutate(name, args).catch(() => {});

const nf = reactive({ title: '', statusId: '' });
// the status must be from the space of the selected project: on a project change we take the first
watch(
  statuses,
  (s) => void (s?.some((x) => x.id === nf.statusId) || (nf.statusId = s?.[0]?.id ?? '')),
  { immediate: true },
);
const create = () =>
  run('forms.create', {
    id: newId(),
    projectId: projectId.value,
    slug: genSlug(),
    title: nf.title.trim(),
    statusId: nf.statusId,
    fields: [{ key: 'title', label: L.title0, required: true }],
  }).then(() => void (nf.title = ''));

const url = (f: FormsForm) => `${location.origin}/f/${f.slug}`;
const copy = (f: FormsForm) => void navigator.clipboard?.writeText(url(f)).catch(() => {});

// personal link: the token is made by the server and shown once (the DB keeps only its hash)
const pl = reactive({ task: '', days: 7, once: true, error: '' });
const issued = reactive<Record<string, string>>({});
async function issue(f: FormsForm) {
  pl.error = '';
  const res = await fetch('/api/forms/links', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formId: f.id,
      task: pl.task.trim(),
      ttlHours: Math.round(pl.days * 24),
      singleUse: pl.once,
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return void (pl.error = j.message || String(res.status));
  issued[f.id] = location.origin + j.path;
}
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="forms-settings">
    <h2 class="text-lg font-semibold">{{ L.title }}</h2>
    <label v-if="!props.projectId" class="flex items-center gap-2">
      {{ L.project }}
      <select
        v-model="projectId"
        data-testid="fm-project"
        class="rounded-md border border-border bg-bg px-2 py-1"
      >
        <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </label>

    <form v-if="admin" class="flex flex-wrap gap-2" @submit.prevent="create()">
      <input
        v-model="nf.title"
        required
        maxlength="200"
        :placeholder="L.name"
        data-testid="fm-title"
        class="rounded-md border border-border bg-bg px-2 py-1"
      />
      <select
        v-model="nf.statusId"
        :aria-label="L.status"
        data-testid="fm-status"
        class="rounded-md border border-border bg-bg px-2 py-1"
      >
        <option v-for="s in statuses" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <button
        type="submit"
        :disabled="!nf.statusId"
        data-testid="fm-create"
        class="rounded-md border border-border px-3 py-1"
      >
        {{ L.create }}
      </button>
    </form>

    <p v-if="!forms?.length" class="text-fg-muted">{{ L.none }}</p>
    <ul class="flex flex-col gap-3">
      <li
        v-for="f in forms"
        :key="f.id"
        class="flex flex-col gap-2 rounded-md border border-border p-3"
        data-testid="fm-form"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">{{ f.title }}</span>
          <label class="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              :checked="f.enabled"
              :disabled="!admin"
              data-testid="fm-enabled"
              @change="run('forms.update', { id: f.id, enabled: !f.enabled })"
            />
            {{ L.on }}
          </label>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-sm">
          {{ L.link }}: <code class="break-all" data-testid="fm-url">{{ url(f) }}</code>
          <button data-testid="fm-copy" @click="copy(f)">{{ L.copy }}</button>
        </div>
        <div v-if="admin" class="flex flex-col gap-1 text-sm" data-testid="fm-personal">
          <span class="text-fg-muted">{{ L.personal }}</span>
          <div class="flex flex-wrap items-center gap-2">
            <input
              v-model="pl.task"
              :placeholder="L.task"
              data-testid="fm-pl-task"
              class="rounded-md border border-border bg-bg px-2 py-0.5"
            />
            <label class="flex items-center gap-1">
              {{ L.days }}
              <input
                v-model.number="pl.days"
                type="number"
                min="1"
                max="30"
                class="w-16 rounded-md border border-border bg-bg px-2 py-0.5"
              />
            </label>
            <label class="flex items-center gap-1">
              <input v-model="pl.once" type="checkbox" />{{ L.once }}
            </label>
            <button :disabled="!pl.task.trim()" data-testid="fm-pl-issue" @click="issue(f)">
              {{ L.issue }}
            </button>
          </div>
          <p v-if="pl.error" class="text-danger" role="alert">{{ pl.error }}</p>
          <p v-if="issued[f.id]">
            {{ L.shown }} <code class="break-all" data-testid="fm-pl-url">{{ issued[f.id] }}</code>
          </p>
        </div>
        <fieldset v-if="admin" class="flex flex-col gap-1">
          <legend class="text-sm text-fg-muted">{{ L.fields }}</legend>
          <div v-for="c in catalog" :key="c.key" class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              :checked="!!find(f, c.key)"
              :disabled="c.key === 'title'"
              :data-testid="`fm-use-${c.key}`"
              @change="toggle(f, c.key, c.label, ($event.target as HTMLInputElement).checked)"
            />
            <template v-if="find(f, c.key)">
              <input
                v-model="find(f, c.key)!.label"
                maxlength="200"
                class="rounded-md border border-border bg-bg px-2 py-0.5"
              />
              <label class="flex items-center gap-1">
                <input
                  v-model="find(f, c.key)!.required"
                  type="checkbox"
                  :disabled="c.key === 'title'"
                />{{ L.req }}
              </label>
            </template>
            <span v-else>{{ c.label }}</span>
          </div>
        </fieldset>
        <div v-if="admin" class="flex gap-2 text-sm">
          <button
            data-testid="fm-save"
            @click="
              run('forms.update', { id: f.id, fields: toRaw(fieldsOf(f)).map((x) => ({ ...x })) })
            "
          >
            {{ L.save }}
          </button>
          <button data-testid="fm-del" @click="run('forms.delete', { id: f.id })">
            {{ L.del }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
