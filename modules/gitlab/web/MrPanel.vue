<script setup lang="ts">
import { computed } from 'vue';
import { tr, useMrs } from './data';

const props = defineProps<{ taskId: string }>();
const mrs = useMrs(() => props.taskId);
const list = computed(() =>
  [...(mrs.value ?? [])].sort((a, b) => b.mrUpdatedAt.localeCompare(a.mrUpdatedAt)),
);
// only http(s): webUrl comes from an external system
const safe = (u: string) => (/^https?:\/\//i.test(u) ? u : undefined);
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="gl-panel">
    <p v-if="!list.length" class="text-sm text-fg-muted">{{ tr('noMrs') }}</p>
    <ul v-else class="flex flex-col gap-1">
      <li
        v-for="m in list"
        :key="m.id"
        class="flex flex-wrap items-baseline gap-2 text-sm"
        data-testid="gl-mr"
      >
        <a
          :href="safe(m.webUrl)"
          target="_blank"
          rel="noopener noreferrer"
          class="font-medium underline"
        >
          !{{ m.iid }} {{ m.title }}
        </a>
        <span class="text-xs" :data-state="m.state" data-testid="gl-state">{{ tr(m.state) }}</span>
      </li>
    </ul>
  </section>
</template>
