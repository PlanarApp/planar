<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ensureFrameCsp } from './csp.js';
import { usePlugins } from './data.js';
import PluginFrame from './PluginFrame.vue';

const plugins = usePlugins();
const route = useRoute();
const plugin = computed(() =>
  plugins.value.find((p) => p.id === route.params.pluginId && p.points.page),
);
const ready = computed(() =>
  plugin.value ? !!ensureFrameCsp(plugins.value.map((p) => p.origin)) : false,
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
