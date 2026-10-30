<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { api } from '../../api/http';
import { Dialog } from '../../ui';
import { moduleSetup } from '../../modules/registry';
import { useAuth } from '../../auth/useAuth';
import { db, mutate, useQuery } from '../../sync';
import SectionHeader from './SectionHeader.vue';
import { useAction } from './shared';

const { t, te } = useI18n();
const { isAdmin } = useAuth();
const { error, run } = useAction();
const server = ref<{ id: string; enabled: boolean; unavailable?: string | null }[]>([]);
/** modules with a setup component (including disabled ones) */
const setups = shallowRef<Record<string, ReturnType<typeof defineAsyncComponent>>>({});
const setupOf = ref<string | null>(null);
const reason = (code: string) =>
  te(`modules.unavailable.${code}`) ? t(`modules.unavailable.${code}`) : code;
const setting = useQuery(() => db.table<Row<'settings'>>('settings').get('enabled_modules'));
const load = () =>
  run(
    async () =>
      (server.value = (await api<{ modules: typeof server.value }>('GET', '/api/modules')).modules),
  );
onMounted(() =>
  load().then(async () => {
    for (const m of server.value) {
      const load = await moduleSetup(m.id);
      if (load) setups.value = { ...setups.value, [m.id]: defineAsyncComponent(load as never) };
    }
  }),
);
// after "Configure" the module's availability could change (for example, SMTP was set)
watch(setupOf, (id, prev) => {
  if (!id && prev) void load();
});
// enabled — only from the replica; no row = nothing enabled (the server response is for reference)
const enabled = computed(
  () => new Set(Array.isArray(setting.value?.value) ? (setting.value.value as string[]) : []),
);
function toggle(id: string, on: boolean) {
  const next = new Set(enabled.value);
  if (on) next.add(id);
  else next.delete(id);
  return run(() => mutate('settings.set', { id: 'enabled_modules', value: [...next] }));
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <SectionHeader :title="t('settings.modules')" :description="t('settings.modulesDesc')" />
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <p v-if="!server.length" class="text-sm text-fg-muted">{{ t('sidebar.empty') }}</p>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="m in server"
        :key="m.id"
        data-testid="module-row"
        class="flex h-11 items-center gap-3 md:h-8"
      >
        <label class="flex flex-1 items-center gap-2 text-sm">
          <input
            type="checkbox"
            role="switch"
            class="size-4"
            :checked="enabled.has(m.id)"
            :disabled="!isAdmin || (!enabled.has(m.id) && !!m.unavailable)"
            @change="(e) => toggle(m.id, (e.target as HTMLInputElement).checked)"
          />
          {{ m.id }}
          <span
            v-if="!enabled.has(m.id) && m.unavailable"
            data-testid="module-unavailable"
            class="text-xs text-fg-muted"
            >{{ reason(m.unavailable) }}</span
          >
        </label>
        <button
          v-if="isAdmin && setups[m.id]"
          type="button"
          data-testid="module-setup"
          class="text-sm underline"
          @click="setupOf = m.id"
        >
          {{ t('modules.setup') }}
        </button>
      </li>
    </ul>
    <Dialog
      :open="!!setupOf"
      :title="t('modules.setup') + ': ' + setupOf"
      size="lg"
      @update:open="(v: boolean) => !v && (setupOf = null)"
    >
      <component :is="setups[setupOf!]" v-if="setupOf && setups[setupOf]" />
    </Dialog>
  </section>
</template>
