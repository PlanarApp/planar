<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Badge, Button, Input, Select } from '../../ui';
import RowMenu from '../settings/RowMenu.vue';
import { ApiError } from '../../api/http';
import {
  addPasskey,
  deletePasskey,
  deviceName,
  getSecurity,
  newRecoveryCodes,
  passkeySupported,
  setLock,
  totpDisable,
  totpEnable,
  totpSetup,
  type Security,
} from '../../api/security';
import { errText } from '../../auth/errText';
import { useAuth } from '../../auth/useAuth';

const { t } = useI18n();
const { mfaSetup, lockPrefs, canLock } = useAuth();
const s = ref<Security | null>(null);
type Block = 'page' | 'passkey' | 'totp' | 'lock';
/** an error is shown in the block of its action, under its controls */
const err = reactive<Record<Block, string>>({ page: '', passkey: '', totp: '', lock: '' });
/** TOTP being connected: QR and secret until confirmed with a code */
const pending = ref<{ secret: string; qr: string } | null>(null);
/** an action that asks for the current code */
const ask = ref<'disable' | 'codes' | null>(null);
const code = ref('');
const codes = ref<string[]>([]);
const copied = ref(false);
const hasFactor = computed(() => !!s.value && (s.value.totp || s.value.passkeys.length > 0));

const fail = (b: Block) => (e: unknown) => {
  err[b] =
    e instanceof ApiError && e.code === 'invalid_credentials'
      ? t('security.badCode')
      : e instanceof ApiError && e.code === 'conflict' && s.value?.required
        ? t('security.lastFactor')
        : e instanceof Error && e.name === 'NotAllowedError'
          ? t('security.passkeyCancelled')
          : errText(e, t);
};

async function load() {
  s.value = await getSecurity();
  // the first factor makes the session full (policy): the app opens
  if (mfaSetup.value && !s.value.setup) mfaSetup.value = false;
  lockPrefs.value = { minutes: s.value.lockMinutes, wipe: s.value.lockWipe };
  canLock.value = s.value.totp || s.value.passkeys.length > 0;
}
onMounted(() => load().catch(fail('page')));

async function act(b: Block, f: () => Promise<unknown>) {
  for (const k of Object.keys(err) as Block[]) err[k] = '';
  try {
    await f();
    await load();
  } catch (e) {
    fail(b)(e);
  }
}

const startTotp = () => act('totp', async () => (pending.value = await totpSetup()));
const confirmTotp = () =>
  act('totp', async () => {
    codes.value = (await totpEnable(code.value.trim())).recoveryCodes;
    pending.value = null;
    code.value = '';
  });
const confirmAsk = () =>
  act('totp', async () => {
    if (ask.value === 'disable') await totpDisable(code.value.trim());
    else codes.value = (await newRecoveryCodes({ code: code.value.trim() })).recoveryCodes;
    ask.value = null;
    code.value = '';
  });
const add = () => act('passkey', () => addPasskey(deviceName()));
const remove = (id: string) => act('passkey', () => deletePasskey(id));

const lockOptions = () => [
  { value: 'off', label: t('security.lockOff') },
  { value: '0', label: t('security.lockOpen') },
  ...[5, 15, 60].map((n) => ({ value: String(n), label: t('security.lockAfter', { n }) })),
];
const saveLock = (minutes: string | null, wipe = s.value!.lockWipe) =>
  act('lock', () =>
    setLock({ lockMinutes: minutes === 'off' || !minutes ? null : +minutes, lockWipe: wipe }),
  );

async function copyCodes() {
  try {
    await navigator.clipboard.writeText(codes.value.join('\n'));
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : '');
</script>

<template>
  <section class="flex flex-col gap-6" data-testid="security" :aria-label="t('security.title')">
    <h2 class="text-lg font-semibold">{{ t('security.title') }}</h2>
    <p
      v-if="mfaSetup"
      role="alert"
      class="rounded-md bg-accent-subtle p-3 text-sm"
      data-testid="mfa-required"
    >
      {{ t('security.requiredSetup') }}
    </p>
    <p v-if="err.page" role="alert" class="text-sm text-danger">{{ err.page }}</p>

    <section v-if="s" class="flex flex-col gap-3">
      <h3 class="text-sm font-medium">{{ t('security.passkeys') }}</h3>
      <p class="text-sm text-fg-muted">{{ t('security.passkeysText') }}</p>
      <ul class="flex flex-col gap-2">
        <li
          v-for="k in s.passkeys"
          :key="k.id"
          class="group flex items-center justify-between gap-2 text-sm"
          data-testid="passkey-row"
        >
          <span class="min-w-0">
            <span class="block truncate">{{ k.name }}</span>
            <span class="text-fg-muted">
              {{ fmt(k.createdAt) }}
              <template v-if="k.lastUsedAt">
                · {{ t('tokens.lastUsed') }}: {{ fmt(k.lastUsedAt) }}</template
              >
            </span>
          </span>
          <RowMenu
            :items="[
              {
                id: 'delete',
                label: t('security.remove'),
                danger: true,
                confirm: {
                  title: t('security.removePasskey'),
                  description: k.name,
                  confirmLabel: t('security.remove'),
                },
                onSelect: () => remove(k.id),
              },
            ]"
          />
        </li>
      </ul>
      <Button v-if="passkeySupported()" class="self-start" data-testid="add-passkey" @click="add">{{
        t('security.addPasskey')
      }}</Button>
      <p v-else class="text-sm text-fg-muted">{{ t('security.passkeyUnsupported') }}</p>
      <p v-if="err.passkey" role="alert" class="text-sm text-danger">{{ err.passkey }}</p>
    </section>

    <section v-if="s" class="flex flex-col gap-3">
      <h3 class="flex items-center gap-2 text-sm font-medium">
        {{ t('security.totp') }}
        <Badge v-if="s.totp">{{ t('security.on') }}</Badge>
        <Button
          v-if="s.totp && !ask"
          size="sm"
          variant="danger-ghost"
          data-testid="totp-disable"
          @click="ask = 'disable'"
          >{{ t('security.disable') }}</Button
        >
      </h3>
      <template v-if="!s.totp">
        <p class="text-sm text-fg-muted">{{ t('security.totpText') }}</p>
        <form v-if="pending" class="flex flex-col gap-3" @submit.prevent="confirmTotp">
          <img :src="pending.qr" alt="" class="size-48 self-start rounded-md bg-white p-1" />
          <p class="text-xs text-fg-muted">{{ t('security.secret') }}</p>
          <code class="break-all text-sm" data-testid="totp-secret">{{ pending.secret }}</code>
          <Input
            v-model="code"
            :label="t('security.code')"
            inputmode="numeric"
            autocomplete="one-time-code"
          />
          <Button type="submit" variant="primary" class="self-start">{{
            t('security.confirm')
          }}</Button>
        </form>
        <Button v-else class="self-start" data-testid="totp-start" @click="startTotp">{{
          t('security.connect')
        }}</Button>
      </template>
      <template v-else>
        <p class="text-sm text-fg-muted">
          {{ t('security.codesLeft', { n: s.recoveryLeft }) }}
        </p>
        <form v-if="ask" class="flex flex-col gap-3" @submit.prevent="confirmAsk">
          <Input v-model="code" :label="t('security.code')" autocomplete="one-time-code" />
          <div class="flex gap-2">
            <Button type="submit" :variant="ask === 'disable' ? 'danger' : 'primary'">{{
              ask === 'disable' ? t('security.disable') : t('security.newCodes')
            }}</Button>
            <Button variant="ghost" @click="ask = null">{{ t('auth.cancel') }}</Button>
          </div>
        </form>
        <Button v-else size="sm" class="self-start" @click="ask = 'codes'">{{
          t('security.newCodes')
        }}</Button>
      </template>
      <p v-if="err.totp" role="alert" class="text-sm text-danger">{{ err.totp }}</p>
      <div
        v-if="codes.length"
        class="flex flex-col gap-2 rounded-md border border-border-strong p-3"
        data-testid="recovery-codes"
      >
        <p class="text-sm">{{ t('security.codesOnce') }}</p>
        <ul class="grid grid-cols-2 gap-1 font-mono text-sm">
          <li v-for="c in codes" :key="c">{{ c }}</li>
        </ul>
        <div class="flex items-center gap-2">
          <Button size="sm" @click="copyCodes">{{ t('tokens.copy') }}</Button>
          <span v-if="copied" role="status" class="text-sm text-fg-muted">{{
            t('tokens.copied')
          }}</span>
          <Button size="sm" variant="ghost" @click="codes = []">{{ t('tokens.hide') }}</Button>
        </div>
      </div>
    </section>

    <section v-if="s" class="flex flex-col gap-3">
      <h3 class="text-sm font-medium">{{ t('security.lock') }}</h3>
      <p class="text-sm text-fg-muted">
        {{ hasFactor ? t('security.lockText') : t('security.lockNeedsFactor') }}
      </p>
      <Select
        :model-value="s.lockMinutes === null ? 'off' : String(s.lockMinutes)"
        :label="t('security.lock')"
        :options="lockOptions()"
        :disabled="!hasFactor"
        @update:model-value="(v) => saveLock(v)"
      />
      <label v-if="s.lockMinutes !== null" class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          :checked="s.lockWipe"
          data-testid="lock-wipe"
          @change="saveLock(String(s.lockMinutes), ($event.target as HTMLInputElement).checked)"
        />
        {{ t('security.lockWipe') }}
      </label>
      <p v-if="err.lock" role="alert" class="text-sm text-danger">{{ err.lock }}</p>
    </section>
  </section>
</template>
