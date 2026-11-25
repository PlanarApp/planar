<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { useAuth } from '../../auth/useAuth';
import { UserPicker, avatarSrc } from '../../pickers';
import { Avatar, Button, ConfirmDialog, Select, type MenuItem } from '../../ui';
import { db, mutate, newId, useQuery } from '../../sync';
import RowMenu from './RowMenu.vue';
import SectionHeader from './SectionHeader.vue';
import { byName, useAction, useAdminSpaces } from './shared';

const props = defineProps<{ spaceId: string }>();
const { t } = useI18n();
const { error, run } = useAction();
const isAdmin = useAdminSpaces();
const canEdit = computed(() => isAdmin(props.spaceId));
const data = useQuery(async () => ({
  space: await db.table<Row<'spaces'>>('spaces').get(props.spaceId),
  root: (await db.table<Row<'settings'>>('settings').get('root_space'))?.value,
  members: await db.table<Row<'spaceMembers'>>('spaceMembers').toArray(),
  users: (await db.table<Row<'users'>>('users').toArray()).sort(byName),
}));
// the Workspace (root space) is the source of the composition; any other space mirrors it or has its own list
const isRoot = computed(() => data.value?.root === props.spaceId);
const inherit = computed(() => data.value?.space?.membersMode === 'inherit');
const modes = computed(() => [
  { value: 'inherit', label: t('settings.spaceMembersInherit') },
  { value: 'custom', label: t('settings.membersCustom') },
]);
// to «Свой состав» — the current members with roles; ids are client uuids
const setMode = (mode: string) =>
  mode !== (inherit.value ? 'inherit' : 'custom') &&
  run(() =>
    mutate('space.setMembersMode', {
      spaceId: props.spaceId,
      mode,
      ...(mode === 'custom' && {
        members: rows.value.map((r) => ({ id: newId(), userId: r.m.userId, role: r.m.role })),
      }),
    }),
  );
const rows = computed(() => {
  const users = new Map(data.value?.users.map((u) => [u.id, u]));
  return (data.value?.members ?? [])
    .filter((m) => m.spaceId === props.spaceId)
    .map((m) => ({ m, u: users.get(m.userId) }))
    .filter((r) => r.u);
});
const free = computed(() => {
  const inSpace = new Set(rows.value.map((r) => r.m.userId));
  return (data.value?.users ?? []).filter((u) => !inSpace.has(u.id) && !u.deactivatedAt);
});
const roles = computed(() =>
  (['admin', 'member', 'guest'] as const).map((r) => ({ value: r, label: t(`auth.roles.${r}`) })),
);
const userId = ref<string | null>(null);
const role = ref('member');

const add = () =>
  userId.value &&
  run(async () => {
    await mutate('member.add', {
      id: newId(),
      spaceId: props.spaceId,
      userId: userId.value,
      role: role.value,
    });
    userId.value = null;
  });
// «Sign in» as any member (PLNRAPP-129)
const { impersonate, canImpersonate } = useAuth();
const asUser = ref<Row<'users'> | null>(null);
const signIn = () => {
  const u = asUser.value;
  if (u) void run(() => impersonate(u.id));
};
const setRole = (id: string, v: string | null) =>
  run(() => mutate('member.update', { id, role: v }));
const remove = (id: string) => run(() => mutate('member.remove', { id }));
// row actions: «Sign in» (instance admin, by role rank) and «Remove» (admin of the space, own list only)
const menu = (r: { m: Row<'spaceMembers'>; u?: Row<'users'> }): MenuItem[] => [
  ...(r.u && canImpersonate(r.u)
    ? [
        {
          id: 'impersonate',
          label: t('settings.impersonate'),
          onSelect: () => (asUser.value = r.u!),
        },
      ]
    : []),
  ...(canEdit.value && !inherit.value
    ? [
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
      ]
    : []),
];
</script>

<template>
  <section class="flex flex-col gap-3">
    <SectionHeader :title="t('settings.members')" :description="t('settings.membersDesc')">
      <form
        v-if="canEdit && !inherit"
        class="flex flex-wrap items-end gap-2 max-md:w-full"
        @submit.prevent="add"
      >
        <UserPicker
          :users="free"
          :selected="userId ? [userId] : []"
          :title="t('settings.user')"
          :empty="t('settings.user')"
          field
          @pick="userId = $event"
        />
        <Select v-model="role" :label="t('auth.role')" :options="roles" />
        <Button type="submit" variant="primary" size="sm" data-testid="member-add">{{
          t('settings.add')
        }}</Button>
      </form>
    </SectionHeader>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <div
      v-if="!isRoot"
      role="radiogroup"
      :aria-label="t('settings.members')"
      class="flex flex-wrap gap-4"
    >
      <label v-for="o in modes" :key="o.value" class="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="space-members-mode"
          class="size-4"
          :data-testid="`space-mode-${o.value}`"
          :value="o.value"
          :checked="(o.value === 'inherit') === inherit"
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
        data-testid="member-row"
        class="group flex items-center gap-3 py-1"
      >
        <Avatar :name="r.u!.name" :src="avatarSrc(r.u)" />
        <span class="min-w-0 flex-1 truncate text-sm">{{ r.u!.name }}</span>
        <Select
          :model-value="r.m.role"
          :label="t('auth.role')"
          :options="roles"
          :disabled="!canEdit || inherit"
          @update:model-value="(v) => setRole(r.m.id, v)"
        />
        <RowMenu v-if="menu(r).length" :items="menu(r)" />
      </li>
    </ul>
    <ConfirmDialog
      :open="!!asUser"
      :title="t('settings.impersonateTitle', { name: asUser?.name ?? '' })"
      :description="t('settings.impersonateDesc')"
      :confirm-label="t('settings.impersonate')"
      :danger="false"
      @update:open="(v) => !v && (asUser = null)"
      @confirm="signIn"
    />
  </section>
</template>
