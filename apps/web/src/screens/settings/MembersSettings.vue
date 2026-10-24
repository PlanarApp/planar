<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Avatar, Button, Select } from '../../ui';
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
  members: await db.table<Row<'spaceMembers'>>('spaceMembers').toArray(),
  users: (await db.table<Row<'users'>>('users').toArray()).sort(byName),
}));
const rows = computed(() => {
  const users = new Map(data.value?.users.map((u) => [u.id, u]));
  return (data.value?.members ?? [])
    .filter((m) => m.spaceId === props.spaceId)
    .map((m) => ({ m, u: users.get(m.userId) }))
    .filter((r) => r.u);
});
const free = computed(() => {
  const inSpace = new Set(rows.value.map((r) => r.m.userId));
  return (data.value?.users ?? [])
    .filter((u) => !inSpace.has(u.id) && !u.deactivatedAt)
    .map((u) => ({ value: u.id, label: u.name }));
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
const setRole = (id: string, v: string | null) =>
  run(() => mutate('member.update', { id, role: v }));
const remove = (id: string) => run(() => mutate('member.remove', { id }));
</script>

<template>
  <section class="flex flex-col gap-3">
    <SectionHeader :title="t('settings.members')" :description="t('settings.membersDesc')">
      <form v-if="canEdit" class="flex flex-wrap items-end gap-2" @submit.prevent="add">
        <Select v-model="userId" :label="t('settings.user')" :options="free" />
        <Select v-model="role" :label="t('auth.role')" :options="roles" />
        <Button type="submit" variant="primary" size="sm" data-testid="member-add">{{
          t('settings.add')
        }}</Button>
      </form>
    </SectionHeader>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="r in rows"
        :key="r.m.id"
        data-testid="member-row"
        class="group flex items-center gap-3 py-1"
      >
        <Avatar :name="r.u!.name" />
        <span class="min-w-0 flex-1 truncate text-sm">{{ r.u!.name }}</span>
        <Select
          :model-value="r.m.role"
          :label="t('auth.role')"
          :options="roles"
          :disabled="!canEdit"
          @update:model-value="(v) => setRole(r.m.id, v)"
        />
        <RowMenu
          v-if="canEdit"
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
