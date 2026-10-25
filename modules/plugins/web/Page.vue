<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ensureWhenLoaded } from './csp.js';
import { usePlugins } from './data.js';
import PluginFrame from './PluginFrame.vue';

const plugins = usePlugins();
const route = useRoute();
const plugin = computed(() =>
  plugins.value?.find((p) => p.id === route.params.pluginId && p.points.page),
);
const ready = computed(
  () => !!plugin.value && ensureWhenLoaded(plugins.value?.map((p) => p.origin)),
);
</script>

<template>
  <PluginFrame
    v-if="plugin && ready"
    :key="plugin.id"
    :plugin="plugin"
    :context="{ point: 'page' }"
    data-testid="plugins-page"
  />
</template>
