<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Avatar, Button, Input, Select, Tabs, useTheme } from '../ui';
import { api } from '../api/http';
import { uploadFile } from '../api/files';
import { useAuth, type User } from '../auth/useAuth';
import { errText } from '../auth/errText';
import PushToggle from '../inbox/PushToggle.vue';
import TokensSection from './profile/TokensSection.vue';
import { setWeekStart } from '../i18n/week';
import { setLocale, type Locale } from '../i18n';

const { t, locale } = useI18n();
const { user } = useAuth();
const { theme } = useTheme();
const tab = ref('profile');
const weekPref = ref(readPref());
function readPref(): string {
  try {
    return localStorage.getItem('planar.weekStart') ?? 'auto';
  } catch {
    return 'auto';
  }
}
function onWeek(v: string | null) {
  if (!v) return;
  weekPref.value = v;
  setWeekStart(v === 'auto' ? v : (Number(v) as 0 | 1));
}
const f = reactive({ name: user.value?.name ?? '', email: user.value?.email ?? '', password: '' });
const msg = ref('');
const fileInput = ref<HTMLInputElement>();
const err = reactive({ profile: '', password: '', avatar: '' });

async function patch(body: Record<string, unknown>) {
  const r = await api<{ user: User }>('PATCH', `/api/users/${user.value!.id}`, body);
  user.value = r.user;
  msg.value = t('auth.saved');
}

async function setAvatar(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  err.avatar = '';
  try {
    await patch({ avatarFile: (await uploadFile(file)).sha256 });
  } catch (e) {
    err.avatar = errText(e, t);
  }
}

async function removeAvatar() {
  err.avatar = '';
  try {
    await patch({ avatarFile: null });
  } catch (e) {
    err.avatar = errText(e, t);
  }
}

async function saveProfile() {
  err.profile = '';
  try {
    await patch({ name: f.name.trim(), email: f.email.trim() || null });
  } catch (e) {
    err.profile = errText(e, t);
  }
}

async function savePassword() {
  err.password = '';
  if (f.password.length < 8) {
    err.password = t('auth.tooShort');
    return;
  }
  try {
    await patch({ password: f.password });
    f.password = '';
  } catch (e) {
    err.password = errText(e, t);
  }
}

const themes = () => [
  { value: 'system', label: t('topbar.themeSystem') },
  { value: 'light', label: t('topbar.themeLight') },
  { value: 'dark', label: t('topbar.themeDark') },
];
</script>

<template>
  <div v-if="user" class="mx-auto flex max-w-md flex-col gap-8 p-4">
    <Tabs
      v-model="tab"
      :label="t('profile.title')"
      size="md"
      :items="[
        { value: 'profile', label: t('profile.title') },
        { value: 'mcp', label: t('profile.mcp') },
      ]"
    />
    <TokensSection v-if="tab === 'mcp'" />
    <template v-else>
      <section class="flex flex-col gap-3" :aria-label="t('profile.title')">
        <h2 class="text-lg font-semibold">{{ t('profile.title') }}</h2>
        <div class="flex flex-wrap items-center gap-3">
          <Avatar
            :name="user.name"
            :src="user.avatarFile ? `/files/${user.avatarFile}/preview?w=256` : null"
            size="lg"
          />
          <span class="text-sm text-fg-muted">{{ user.login }}</span>
          <Button size="sm" @click="fileInput?.click()">{{ t('auth.avatarUpload') }}</Button>
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            class="sr-only"
            tabindex="-1"
            @change="setAvatar"
          />
          <Button v-if="user.avatarFile" size="sm" variant="ghost" @click="removeAvatar">
            {{ t('auth.avatarRemove') }}
          </Button>
        </div>
        <p v-if="err.avatar" role="alert" class="text-sm text-danger">{{ err.avatar }}</p>
        <form class="flex flex-col gap-3" @submit.prevent="saveProfile">
          <Input v-model="f.name" :label="t('auth.name')" />
          <Input v-model="f.email" type="email" :label="t('auth.email')" :error="err.profile" />
          <div>
            <Button type="submit" variant="primary">{{ t('auth.save') }}</Button>
          </div>
        </form>
        <form class="flex flex-col gap-3" @submit.prevent="savePassword">
          <Input
            v-model="f.password"
            type="password"
            :label="t('auth.newPassword')"
            :error="err.password"
          />
          <div>
            <Button type="submit">{{ t('auth.save') }}</Button>
          </div>
        </form>
      </section>
      <section class="flex flex-col gap-3" :aria-label="t('profile.appearance')">
        <h2 class="text-lg font-semibold">{{ t('profile.appearance') }}</h2>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-fg-muted">{{ t('topbar.theme') }}</span>
          <Select
            :model-value="theme"
            :label="t('topbar.theme')"
            :options="themes()"
            @update:model-value="(v) => (theme = v as typeof theme)"
          />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-fg-muted">{{ t('topbar.language') }}</span>
          <Select
            :model-value="locale"
            :label="t('topbar.language')"
            :options="[
              { value: 'ru', label: 'Русский' },
              { value: 'en', label: 'English' },
            ]"
            @update:model-value="(v) => setLocale(v as Locale)"
          />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs text-fg-muted">{{ t('profile.weekStart') }}</span>
          <Select
            :model-value="weekPref"
            :label="t('profile.weekStart')"
            :options="[
              { value: 'auto', label: t('profile.weekAuto') },
              { value: '1', label: t('profile.weekMon') },
              { value: '0', label: t('profile.weekSun') },
            ]"
            @update:model-value="onWeek"
          />
        </div>
      </section>
      <section class="flex flex-col gap-3" :aria-label="t('profile.notifications')">
        <h2 class="text-lg font-semibold">{{ t('profile.notifications') }}</h2>
        <PushToggle />
      </section>
    </template>
    <p v-if="msg" role="status" class="text-sm text-fg-muted">{{ msg }}</p>
  </div>
</template>
