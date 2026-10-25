<script setup lang="ts">
import { reactive, ref } from 'vue';
import { newId } from '@planar/web/modules';
import { PLUGIN_ENTITIES, PLUGIN_WRITES } from '../shared/index.js';
import { allPlugins, api, tr } from './data.js';

const plugins = allPlugins();
const err = ref('');
const f = reactive({
  name: '',
  url: '',
  read: [] as string[],
  write: [] as string[],
  panel: '',
  page: '',
});
const run = (p: Promise<unknown>) =>
  p.then(() => (err.value = '')).catch((e) => void (err.value = String(e?.message ?? e)));
const add = () =>
  run(
    api('POST', '/api/plugins/admin', {
      id: newId(),
      name: f.name.trim(),
      url: f.url.trim(),
      permissions: { read: f.read, write: f.write },
      points: {
        taskPanel: f.panel.trim() ? { label: f.panel.trim() } : null,
        page: f.page.trim() ? { label: f.page.trim() } : null,
      },
    }).then(() =>
      Object.assign(f, { name: '', url: '', read: [], write: [], panel: '', page: '' }),
    ),
  );
const toggle = (id: string, enabled: boolean) =>
  run(api('PATCH', `/api/plugins/admin/${id}`, { enabled }));
const del = (id: string) => run(api('DELETE', `/api/plugins/admin/${id}`));
</script>

<template>
  <section class="flex flex-col gap-4" data-testid="plugins-admin">
    <h2 class="text-lg font-semibold">{{ tr('admin') }}</h2>
    <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
    <ul class="flex flex-col gap-1">
      <li v-for="p in plugins ?? []" :key="p.id" class="flex items-center gap-3 text-sm">
        <label class="flex items-center gap-1">
          <input
            type="checkbox"
            :checked="p.enabled"
            @change="toggle(p.id, ($event.target as HTMLInputElement).checked)"
          />
          {{ p.name }}
        </label>
        <span class="text-fg-muted">{{ p.origin }}</span>
        <button class="underline" @click="del(p.id)">{{ tr('remove') }}</button>
      </li>
    </ul>
    <form class="flex flex-col gap-2" @submit.prevent="add">
      <input v-model="f.name" :placeholder="tr('name')" required class="rounded border px-2 py-1" />
      <input v-model="f.url" :placeholder="tr('url')" required class="rounded border px-2 py-1" />
      <fieldset class="flex flex-wrap gap-3 text-sm">
        <legend>{{ tr('read') }}</legend>
        <label v-for="e in PLUGIN_ENTITIES" :key="e"
          ><input v-model="f.read" type="checkbox" :value="e" /> {{ e }}</label
        >
      </fieldset>
      <fieldset class="flex flex-wrap gap-3 text-sm">
        <legend>{{ tr('write') }}</legend>
        <label v-for="e in PLUGIN_WRITES" :key="e"
          ><input v-model="f.write" type="checkbox" :value="e" /> {{ e }}</label
        >
      </fieldset>
      <input
        v-model="f.panel"
        :placeholder="tr('taskPanel') + ' — ' + tr('label')"
        class="rounded border px-2 py-1"
      />
      <input
        v-model="f.page"
        :placeholder="tr('page') + ' — ' + tr('label')"
        class="rounded border px-2 py-1"
      />
      <button type="submit" class="self-start rounded border px-3 py-1">{{ tr('add') }}</button>
    </form>
  </section>
</template>
