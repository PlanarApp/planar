<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Avatar, Button, Select } from '../../ui';
import { useAuth } from '../../auth/useAuth';
import { db, mutate, newId, useQuery } from '../../sync';
import RowMenu from './RowMenu.vue';
import SectionHeader from './SectionHeader.vue';
import { byName, useAction, useAdminSpaces } from './shared';

// C-mutators v14 (PJ-11): composition of the project — as in the space (read-only) or its own
const props = defineProps<{ projectId: string }>();
defineOptions({ inheritAttrs: false }); // SettingsScreen also passes spaceId / level
const { t } = useI18n();
const { isAdmin } = useAuth();
const { error, run } = useAction();
const isSpaceAdmin = useAdminSpaces();
const data = useQuery(async () => ({
  project: await db.table<Row<'projects'>>('projects').get(props.projectId),
  space: await db.table<Row<'spaceMembers'>>('spaceMembers').toArray(),
  own: await db
    .table<Row<'projectMembers'>>('projectMembers')
    .filter((m) => m.projectId === props.projectId)
    .toArray(),
  users: (await db.table<Row<'users'>>('users').toArray()).sort(byName),
}));
const project = computed(() => data.value?.project);
const custom = computed(() => project.value?.membersMode === 'custom');
const canEdit = computed(
  () => isAdmin.value || (!!project.value && isSpaceAdmin(project.value.spaceId)),
);
const inSpace = computed(() =>
  (data.value?.space ?? []).filter((m) => m.spaceId === project.value?.spaceId),
);
const rows = computed(() => {
  const users = new Map(data.value?.users.map((u) => [u.id, u]));
  return (custom.value ? (data.value?.own ?? []) : inSpace.value)
    .map((m) => ({ m, u: users.get(m.userId) }))
    .filter((r) => r.u)
    .sort((a, b) => byName(a.u!, b.u!));
});
// candidates — members of the project's space who are not in the project yet
const free = computed(() => {
  const have = new Set(rows.value.map((r) => r.m.userId));
  const users = new Map(data.value?.users.map((u) => [u.id, u]));
  return inSpace.value
    .filter(
      (m) => !have.has(m.userId) && users.get(m.userId) && !users.get(m.userId)!.deactivatedAt,
    )
    .map((m) => ({ value: m.userId, label: users.get(m.userId)!.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
});
const roles = computed(() =>
  (['admin', 'member', 'guest'] as const).map((r) => ({ value: r, label: t(`auth.roles.${r}`) })),
);
const modes = computed(() => [
  { value: 'inherit', label: t('settings.membersInherit') },
  { value: 'custom', label: t('settings.membersCustom') },
]);
const userId = ref<string | null>(null);
const role = ref('member');

// to «Свой состав» — the current composition of the space with roles; ids are client uuids
const setMode = (mode: string) =>
  mode !== (custom.value ? 'custom' : 'inherit') &&
  run(() =>
    mutate('project.setMembersMode', {
      projectId: props.projectId,
      mode,
      ...(mode === 'custom' && {
        members: inSpace.value.map((m) => ({ id: newId(), userId: m.userId, role: m.role })),
      }),
    }),
  );
const add = () =>
  userId.value &&
  run(async () => {
    await mutate('projectMember.add', {
      id: newId(),
      projectId: props.projectId,
      userId: userId.value,
      role: role.value,
    });
    userId.value = null;
  });
const setRole = (id: string, v: string | null) =>
  run(() => mutate('projectMember.setRole', { id, role: v }));
const remove = (id: string) => run(() => mutate('projectMember.remove', { id }));
</script>

<template>
  <section class="flex flex-col gap-3">
    <SectionHeader
      :title="t('settings.projectMembers')"
      :description="t('settings.projectMembersDesc')"
    >
      <form v-if="canEdit && custom" class="flex flex-wrap items-end gap-2" @submit.prevent="add">
        <Select v-model="userId" :label="t('settings.user')" :options="free" />
        <Select v-model="role" :label="t('auth.role')" :options="roles" />
        <Button type="submit" variant="primary" size="sm" data-testid="pmember-add">{{
          t('settings.add')
        }}</Button>
      </form>
    </SectionHeader>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <div role="radiogroup" :aria-label="t('settings.projectMembers')" class="flex flex-wrap gap-4">
      <label v-for="o in modes" :key="o.value" class="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="members-mode"
          class="size-4"
          :data-testid="`mode-${o.value}`"
          :value="o.value"
          :checked="(o.value === 'custom') === custom"
          :disabled="!canEdit"
          @change="setMode(o.value)"
        />
        {{ o.label }}
      </label>
    </div>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="r in rows"
        :key="r.m.id"
        data-testid="pmember-row"
        class="group flex items-center gap-3 py-1"
      >
        <Avatar :name="r.u!.name" />
        <span class="min-w-0 flex-1 truncate text-sm">{{ r.u!.name }}</span>
        <Select
          :model-value="r.m.role"
          :label="t('auth.role')"
          :options="roles"
          :disabled="!canEdit || !custom"
          @update:model-value="(v) => setRole(r.m.id, v)"
        />
        <RowMenu
          v-if="canEdit && custom"
          :items="[
            {
              id: 'remove',
              label: t('settings.remove'),
              danger: true,
              confirm: {
                title: t('settings.removeMember'),
                description: r.u!.name,
                confirmLabel: t('settings.remove'),
              },
              onSelect: () => remove(r.m.id),
            },
          ]"
        />
      </li>
    </ul>
  </section>
</template>
