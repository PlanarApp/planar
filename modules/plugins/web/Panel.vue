<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { ensureFrameCsp } from './csp.js';
import { taskContext, tr, usePlugins } from './data.js';
import PluginFrame from './PluginFrame.vue';
import { useQuery } from '@planar/web/modules';

const props = defineProps<{ taskId: string }>();
const plugins = usePlugins();
const list = computed(() => plugins.value.filter((p) => p.points.taskPanel));
const ctx = useQuery(() => taskContext(props.taskId));
// до первого iframe; ключ iframe — taskId (смена задачи = новый iframe)
watchEffect(() => {
  if (ctx.value) ensureFrameCsp(plugins.value.map((p) => p.origin));
});
</script>

<template>
  <section v-if="ctx" class="flex flex-col gap-3" data-testid="plugins-panel">
    <p v-if="!list.length" class="text-sm text-fg-muted">{{ tr('none') }}</p>
    <PluginFrame v-for="p in list" :key="p.id + props.taskId" :plugin="p" :context="ctx" />
  </section>
</template>
