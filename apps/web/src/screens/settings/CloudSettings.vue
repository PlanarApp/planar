<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, ApiError } from '../../api/http';
import { useAuth } from '../../auth/useAuth';
import { Button, Input } from '../../ui';
import SectionHeader from './SectionHeader.vue';

/** CloudState of docs/contracts/cloud-link.md */
type CloudState = {
  status: 'trial' | 'active' | 'expired';
  trialEndsAt: string;
  deleteAfter: string | null;
  domain: string;
  customDomain: string | null;
  serverIp: string | null;
  checkout: Record<string, string>;
  manageUrl: string | null;
};
const PROVIDERS: Record<string, string> = {
  paddle: 'Paddle',
  lemonsqueezy: 'Lemon Squeezy',
  yookassa: 'ЮKassa',
  cloudpayments: 'CloudPayments',
};

const { t, te, locale } = useI18n();
const { user } = useAuth();
const s = ref<CloudState | null>(null);
const busy = ref(false);
const error = ref('');
const host = ref('');
const confirm = ref('');
const deleting = ref(false);

const name = computed(() => s.value?.domain.split('.')[0] ?? '');
const daysLeft = computed(() =>
  s.value ? Math.max(0, Math.ceil((Date.parse(s.value.trialEndsAt) - Date.now()) / 86400_000)) : 0,
);
const date = (iso: string) =>
  new Date(iso).toLocaleDateString(locale.value, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

// cloud error codes come in details.cloud (h3 statusMessage of planar-cloud)
function errText(e: unknown) {
  if (!(e instanceof ApiError)) return t('auth.failed');
  const det = e.details as { cloud?: string; data?: unknown } | undefined;
  const key = `cloud.err.${det?.cloud ?? e.code}`;
  return te(key) ? t(key, { ip: String(det?.data ?? s.value?.serverIp ?? '') }) : e.message;
}
async function run(f: () => Promise<CloudState | void>) {
  busy.value = true;
  error.value = '';
  try {
    const r = await f();
    if (r) s.value = r;
    return true;
  } catch (e) {
    error.value = errText(e);
    return false;
  } finally {
    busy.value = false;
  }
}
const load = () => run(() => api<CloudState>('GET', '/api/cloud'));
onMounted(load);
const setDomain = (h: string | null) =>
  run(() => api<CloudState>('POST', '/api/cloud/domain', { host: h })).then(
    (ok) => ok && (host.value = ''),
  );
// wipe: the cloud restarts this instance, its waiting page then signs the owner in with the new password
const resetPassword = ref('');
const resetConfirm = ref('');
const reset = () =>
  run(async () => {
    const r = await api<{ url: string }>('POST', '/api/cloud/reset', {
      confirm: resetConfirm.value,
      password: resetPassword.value,
    });
    window.location.assign(r.url);
  });
// the archive is built by the cloud; the download goes straight from the cloud (link valid 10 minutes)
const exportData = () =>
  run(async () => {
    window.location.assign((await api<{ url: string }>('POST', '/api/cloud/export')).url);
  });
async function remove() {
  busy.value = true;
  error.value = '';
  try {
    await api('POST', '/api/cloud/delete', { confirm: confirm.value });
    deleting.value = true;
  } catch (e) {
    // the instance may be gone before the answer comes back
    if (e instanceof ApiError && e.status === 0) deleting.value = true;
    else error.value = errText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex max-w-2xl flex-col gap-6">
    <SectionHeader :title="t('settings.cloud')" :description="t('cloud.desc')">
      <Button size="sm" :loading="busy && !s" @click="load">{{ t('cloud.refresh') }}</Button>
    </SectionHeader>
    <p v-if="deleting" role="status" class="text-sm">{{ t('cloud.deleting') }}</p>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <template v-if="s && !deleting">
      <section class="flex flex-col gap-2" data-testid="cloud-status">
        <h3 class="font-medium">{{ t('cloud.subscription') }}</h3>
        <p v-if="s.status === 'trial'" class="text-sm">
          {{ t('cloud.trial', { date: date(s.trialEndsAt), n: daysLeft }) }}
        </p>
        <p v-else-if="s.status === 'active'" class="text-sm">{{ t('cloud.active') }}</p>
        <p v-else class="text-sm text-danger">
          {{ t('cloud.expired') }}
          <template v-if="s.deleteAfter">{{
            t('cloud.deleteAfter', { date: date(s.deleteAfter) })
          }}</template>
        </p>
        <div class="flex flex-wrap gap-2">
          <template v-if="s.status !== 'active'">
            <a
              v-for="(url, p) in s.checkout"
              :key="p"
              :href="url"
              target="_blank"
              rel="noopener"
              class="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90"
              >{{ t('cloud.pay', { provider: PROVIDERS[p] ?? p }) }}</a
            >
            <span v-if="!Object.keys(s.checkout).length" class="text-sm text-fg-muted">{{
              t('cloud.noCheckout')
            }}</span>
          </template>
          <a
            v-if="s.manageUrl"
            :href="s.manageUrl"
            target="_blank"
            rel="noopener"
            class="inline-flex h-8 items-center text-sm text-accent hover:underline"
            >{{ t('cloud.manage') }}</a
          >
        </div>
        <p v-if="s.status !== 'active'" class="text-xs text-fg-muted">{{ t('cloud.payHint') }}</p>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="font-medium">{{ t('cloud.address') }}</h3>
        <p class="text-sm">
          <a :href="`https://${s.domain}`" class="text-accent hover:underline">{{ s.domain }}</a>
        </p>
        <template v-if="s.customDomain">
          <p class="text-sm">
            {{ t('cloud.customDomain') }}:
            <a :href="`https://${s.customDomain}`" class="text-accent hover:underline">{{
              s.customDomain
            }}</a>
          </p>
          <div>
            <Button size="sm" :loading="busy" @click="setDomain(null)">{{
              t('cloud.unbind')
            }}</Button>
          </div>
        </template>
        <!-- свой домен — только на оплаченной подписке -->
        <p v-else-if="s.status !== 'active'" class="text-sm text-fg-muted">
          {{ t('cloud.domainPaidOnly') }}
        </p>
        <form
          v-else
          class="flex flex-wrap items-end gap-2"
          @submit.prevent="setDomain(host.trim())"
        >
          <Input
            v-model="host"
            :label="t('cloud.customDomain')"
            placeholder="tasks.example.com"
            class="min-w-64"
          />
          <Button type="submit" :loading="busy" :disabled="!host.trim()">{{
            t('cloud.bind')
          }}</Button>
          <p class="w-full text-xs text-fg-muted">
            {{ t('cloud.dnsHint', { ip: s.serverIp ?? '—' }) }}
          </p>
        </form>
      </section>

      <section v-if="user?.role === 'owner'" class="flex flex-col gap-2">
        <h3 class="font-medium">{{ t('cloud.export') }}</h3>
        <p class="text-sm text-fg-muted">{{ t('cloud.exportHint') }}</p>
        <div>
          <Button size="sm" :loading="busy" data-testid="cloud-export" @click="exportData">{{
            t('cloud.exportGo')
          }}</Button>
        </div>
      </section>

      <section v-if="user?.role === 'owner' && s.status !== 'expired'" class="flex flex-col gap-2">
        <h3 class="font-medium text-danger">{{ t('cloud.reset') }}</h3>
        <p class="text-sm text-fg-muted">{{ t('cloud.resetHint', { name }) }}</p>
        <form class="flex flex-wrap items-end gap-2" @submit.prevent="reset">
          <Input
            v-model="resetPassword"
            type="password"
            :label="t('cloud.resetPassword')"
            autocomplete="new-password"
          />
          <Input v-model="resetConfirm" :label="t('cloud.deleteConfirm')" :placeholder="name" />
          <Button
            type="submit"
            variant="danger"
            :loading="busy"
            :disabled="resetConfirm !== name || resetPassword.length < 8"
            >{{ t('cloud.resetGo') }}</Button
          >
        </form>
      </section>

      <section v-if="user?.role === 'owner'" class="flex flex-col gap-2">
        <h3 class="font-medium text-danger">{{ t('cloud.delete') }}</h3>
        <p class="text-sm text-fg-muted">{{ t('cloud.deleteHint', { name }) }}</p>
        <form class="flex flex-wrap items-end gap-2" @submit.prevent="remove">
          <Input v-model="confirm" :label="t('cloud.deleteConfirm')" :placeholder="name" />
          <Button type="submit" variant="danger" :loading="busy" :disabled="confirm !== name">{{
            t('cloud.deleteGo')
          }}</Button>
        </form>
      </section>
    </template>
  </div>
</template>
