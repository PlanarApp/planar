<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { checkPluginUrl, type Plugin } from '../shared/index.js';
import { createBridge, type BridgeContext } from './bridge.js';
import { frameAllowed } from './csp.js';
import { locale, mutateVia, queryReplica, theme, tr, useRouter, useSession } from './data.js';

const props = defineProps<{ plugin: Plugin; context: BridgeContext }>();
const router = useRouter();
const user = useSession();
const frame = ref<HTMLIFrameElement>();
const height = ref(240);
// проверка перед показом (allow-same-origin безопасен только на чужом хосте)
const ok = computed(
  () => checkPluginUrl(props.plugin.url, location.origin, import.meta.env.PROD) === null,
);
// без сессии iframe не показываем: мост создаётся, когда элемент появился
const allowed = computed(() => ok.value && !!user.value && frameAllowed(props.plugin.origin));
let stop = () => {};

watch(frame, (el) => {
  const win = el?.contentWindow;
  const u = user.value;
  stop();
  if (!win || !u) return;
  const bridge = createBridge(win, props.plugin, {
    query: queryReplica,
    mutate: mutateVia,
    navigate: (p) => void router.push(p),
    resize: (h) => (height.value = h),
    user: { id: u.id, name: u.name, login: u.login, role: u.role },
    context: props.context,
    locale: locale(),
    theme: theme(),
  });
  const on = (e: MessageEvent) => void bridge.onMessage(e);
  window.addEventListener('message', on);
  stop = () => window.removeEventListener('message', on);
});
onBeforeUnmount(() => stop());
</script>

<template>
  <p v-if="!ok" class="text-sm text-danger">{{ plugin.name }}: {{ tr('refused') }}</p>
  <p v-else-if="ok && user && !allowed" class="text-sm text-fg-muted">
    {{ plugin.name }}: {{ tr('reload') }}
  </p>
  <iframe
    v-else-if="allowed"
    ref="frame"
    :src="plugin.url"
    :title="plugin.name"
    sandbox="allow-scripts allow-forms allow-same-origin"
    referrerpolicy="no-referrer"
    class="w-full border-0"
    :style="{ height: context.point === 'page' ? '80vh' : height + 'px' }"
    :data-testid="'plugin-frame-' + plugin.id"
  />
</template>
