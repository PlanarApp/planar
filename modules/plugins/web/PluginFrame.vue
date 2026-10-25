<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
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
const allowed = computed(() => ok.value && frameAllowed(props.plugin.origin));
let stop = () => {};

onMounted(() => {
  const win = frame.value?.contentWindow;
  if (!allowed.value || !win || !user.value) return;
  const u = user.value;
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
  <p v-else-if="!allowed" class="text-sm text-fg-muted">{{ plugin.name }}: {{ tr('reload') }}</p>
  <iframe
    v-else
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
