<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Badge, Button, Input, Select } from '../../ui';
import RowMenu from '../settings/RowMenu.vue';
import {
  createToken,
  listTokens,
  revokeToken,
  type ApiToken,
  type TokenScope,
} from '../../api/tokens';
import { errText } from '../../auth/errText';

const { t } = useI18n();
const tokens = ref<ApiToken[]>([]);
const loaded = ref(false);
const err = ref('');
const secret = ref('');
const copied = ref(false);
const f = reactive({ name: '', scope: 'read' as TokenScope, days: '0' });
const mcpUrl = `${location.origin}/mcp`;
const mcpConfig = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        planar: { type: 'http', url: mcpUrl, headers: { Authorization: 'Bearer <token>' } },
      },
    },
    null,
    2,
  ),
);
const expiries = () =>
  ['0', '30', '90', '365'].map((d) => ({
    value: d,
    label: d === '0' ? t('tokens.never') : t('tokens.days', { n: d }),
  }));

async function load() {
  err.value = '';
  try {
    tokens.value = (await listTokens()).tokens;
    loaded.value = true;
  } catch (e) {
    err.value = errText(e, t);
  }
}

onMounted(load);

async function create() {
  err.value = '';
  const name = f.name.trim();
  if (!name || name.length > 100) {
    err.value = t('tokens.nameInvalid');
    return;
  }
  const days = Number(f.days);
  try {
    const r = await createToken({
      name,
      scope: f.scope,
      expiresAt: days ? new Date(Date.now() + days * 864e5).toISOString() : null,
    });
    secret.value = r.secret;
    copied.value = false;
    tokens.value = [r.token, ...tokens.value];
    f.name = '';
  } catch (e) {
    err.value = errText(e, t);
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}

async function revoke(tk: ApiToken) {
  err.value = '';
  try {
    await revokeToken(tk.id);
    tokens.value = tokens.value.filter((x) => x.id !== tk.id);
  } catch (e) {
    err.value = errText(e, t);
  }
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString() : '');
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="tokens" :aria-label="t('tokens.title')">
    <h2 class="text-lg font-semibold">{{ t('tokens.title') }}</h2>
    <div class="flex flex-col gap-3">
      <form class="flex flex-col gap-3" @submit.prevent="create">
        <Input v-model="f.name" :label="t('tokens.name')" />
        <fieldset class="flex gap-4 text-sm">
          <legend class="mb-1 text-fg-muted">{{ t('tokens.scope') }}</legend>
          <label v-for="s in ['read', 'write']" :key="s" class="flex items-center gap-1">
            <input v-model="f.scope" type="radio" name="scope" :value="s" />
            {{ t(`tokens.${s}`) }}
          </label>
        </fieldset>
        <Select v-model="f.days" :label="t('tokens.expires')" :options="expiries()" />
        <Button type="submit" variant="primary">{{ t('tokens.create') }}</Button>
      </form>
      <div v-if="secret" class="flex flex-col gap-2 rounded-md border border-border-strong p-3">
        <p class="text-sm">{{ t('tokens.secretOnce') }}</p>
        <code data-testid="secret" class="break-all text-sm">{{ secret }}</code>
        <div class="flex items-center gap-2">
          <Button size="sm" data-testid="copy" @click="copy(secret)">{{ t('tokens.copy') }}</Button>
          <span v-if="copied" role="status" class="text-sm text-fg-muted">{{
            t('tokens.copied')
          }}</span>
          <Button size="sm" variant="ghost" @click="secret = ''">{{ t('tokens.hide') }}</Button>
        </div>
      </div>
      <p v-if="err" role="alert" class="text-sm text-danger">{{ err }}</p>
      <p v-if="loaded && !tokens.length" class="text-sm text-fg-muted">{{ t('tokens.empty') }}</p>
      <ul class="flex flex-col gap-2">
        <li
          v-for="tk in tokens"
          :key="tk.id"
          class="group flex items-center justify-between gap-2 text-sm"
          data-testid="token-row"
        >
          <span class="min-w-0">
            <span class="block truncate">{{ tk.name }}</span>
            <span class="text-fg-muted">
              plnr_{{ tk.prefix }}… · {{ t('tokens.expires') }}:
              {{ tk.expiresAt ? fmt(tk.expiresAt) : t('tokens.never') }}
              <template v-if="tk.lastUsedAt">
                · {{ t('tokens.lastUsed') }}: {{ fmt(tk.lastUsedAt) }}
              </template>
            </span>
          </span>
          <Badge>{{ t(`tokens.${tk.scope}`) }}</Badge>
          <RowMenu
            :items="[
              {
                id: 'revoke',
                label: t('tokens.revoke'),
                danger: true,
                confirm: {
                  title: t('tokens.revokeTitle'),
                  description: tk.name,
                  confirmLabel: t('tokens.revoke'),
                },
                onSelect: () => revoke(tk),
              },
            ]"
          />
        </li>
      </ul>
      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium">{{ t('tokens.mcpTitle') }}</h3>
        <p class="text-sm text-fg-muted">{{ t('tokens.mcpText') }}</p>
        <code class="break-all text-sm" data-testid="mcp-url">{{ mcpUrl }}</code>
        <pre class="overflow-x-auto text-xs" data-testid="mcp-config">{{ mcpConfig }}</pre>
        <Button size="sm" class="self-start" @click="copy(mcpConfig)">{{
          t('tokens.copyConfig')
        }}</Button>
      </section>
    </div>
  </section>
</template>
