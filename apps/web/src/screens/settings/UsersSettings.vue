<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Avatar, Badge, Button, ConfirmDialog, Dialog, Input, Select } from '../../ui';
import { api } from '../../api/http';
import { useAuth, type User } from '../../auth/useAuth';
import { errText } from '../../auth/errText';
import SectionHeader from './SectionHeader.vue';

const { t } = useI18n();
const users = ref<User[]>([]);
const open = ref(false);
const error = ref('');
const f = reactive({ login: '', name: '', password: '', role: 'member' });
const roles = () =>
  (['admin', 'member', 'guest'] as const).map((r) => ({ value: r, label: t(`auth.roles.${r}`) }));

// «Sign in» as a user (PLNRAPP-129)
const { impersonate, canImpersonate, user: me } = useAuth();
const asUser = ref<User | null>(null);
const resetFor = ref<User | null>(null);
// 2FA reset (lost phone): REST v1, the server checks the role rules
async function reset2fa() {
  const u = resetFor.value;
  if (!u) return;
  error.value = '';
  try {
    await api('PATCH', `/api/v1/instance/users/${u.id}`, { reset2fa: true });
  } catch (e) {
    error.value = errText(e, t);
  }
}
const signIn = () => {
  const u = asUser.value;
  if (u) impersonate(u.id).catch((e) => (error.value = errText(e, t)));
};

async function load() {
  users.value = (await api<{ users: User[] }>('GET', '/api/users')).users;
}
onMounted(() => load().catch((e) => (error.value = errText(e, t))));

async function patch(u: User, body: Record<string, unknown>) {
  error.value = '';
  try {
    const r = await api<{ user: User }>('PATCH', `/api/users/${u.id}`, body);
    users.value = users.value.map((x) => (x.id === u.id ? r.user : x));
  } catch (e) {
    error.value = errText(e, t);
  }
}

async function create() {
  error.value = '';
  try {
    const r = await api<{ user: User }>('POST', '/api/users', { ...f });
    users.value = [...users.value, r.user];
    open.value = false;
    Object.assign(f, { login: '', name: '', password: '', role: 'member' });
  } catch (e) {
    error.value = errText(e, t);
  }
}
</script>

<template>
  <section class="flex flex-col gap-3">
    <SectionHeader :title="t('auth.users')" :description="t('settings.usersDesc')">
      <Button variant="primary" size="sm" @click="open = true">{{ t('auth.addUser') }}</Button>
    </SectionHeader>
    <p v-if="error && !open" role="alert" class="text-sm text-danger">{{ error }}</p>
    <ul class="flex flex-col divide-y divide-border">
      <li
        v-for="u in users"
        :key="u.id"
        data-testid="user-row"
        class="group flex flex-wrap items-center gap-x-3 gap-y-1 py-1"
      >
        <Avatar :name="u.name" />
        <div class="min-w-32 flex-1">
          <div class="truncate">{{ u.name }}</div>
          <div class="truncate text-xs text-fg-muted">{{ u.login }}</div>
        </div>
        <!-- one group: on a narrow screen it moves under the name as a whole -->
        <div class="ml-auto flex items-center gap-2">
          <Badge v-if="u.deactivatedAt">{{ t('auth.blocked') }}</Badge>
          <Select
            v-if="u.role !== 'owner'"
            :model-value="u.role"
            :label="t('auth.role')"
            :options="roles()"
            @update:model-value="(v) => patch(u, { role: v })"
          />
          <Button
            v-if="u.role !== 'owner'"
            size="sm"
            variant="ghost"
            data-testid="toggle-block"
            @click="patch(u, { deactivated: !u.deactivatedAt })"
          >
            {{ u.deactivatedAt ? t('auth.unblock') : t('auth.block') }}
          </Button>
          <Button
            v-if="u.role !== 'owner' && u.id !== me?.id"
            size="sm"
            variant="ghost"
            data-testid="user-reset-2fa"
            @click="resetFor = u"
            >{{ t('security.reset') }}</Button
          >
          <Button
            v-if="canImpersonate(u)"
            size="sm"
            variant="ghost"
            data-testid="user-impersonate"
            @click="asUser = u"
            >{{ t('settings.impersonate') }}</Button
          >
        </div>
      </li>
    </ul>
    <Dialog v-model:open="open" :title="t('auth.addUser')">
      <form id="user-form" class="flex flex-col gap-3" @submit.prevent="create">
        <Input v-model="f.login" :label="t('auth.login')" />
        <Input v-model="f.name" :label="t('auth.name')" />
        <Input v-model="f.password" type="password" :label="t('auth.password')" />
        <Select v-model="f.role" :label="t('auth.role')" :options="roles()" />
        <p v-if="error" role="alert" class="text-xs text-danger">{{ error }}</p>
      </form>
      <template #footer>
        <Button @click="open = false">{{ t('auth.cancel') }}</Button>
        <Button type="submit" form="user-form" variant="primary">{{ t('auth.create') }}</Button>
      </template>
    </Dialog>
    <ConfirmDialog
      :open="!!resetFor"
      :title="t('security.resetTitle', { name: resetFor?.name ?? '' })"
      :description="t('security.resetDesc')"
      :confirm-label="t('security.reset')"
      @update:open="(v) => !v && (resetFor = null)"
      @confirm="reset2fa"
    />
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
