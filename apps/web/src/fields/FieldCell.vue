<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { useMembers } from '../tasks';
import { formatFieldValue } from './index';

const props = defineProps<{ def: Row<'fieldDefs'>; value?: unknown }>();
const { locale } = useI18n();
const members = useMembers(() => props.def.spaceId);
const text = computed(() =>
  formatFieldValue(props.def, props.value, { locale: locale.value, users: members.value ?? [] }),
);
</script>

<template>
  <span class="truncate">{{ text }}</span>
</template>
