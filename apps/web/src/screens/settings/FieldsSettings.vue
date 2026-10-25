<script setup lang="ts">
import FieldsDialog from '../../fields/FieldsDialog.vue';

defineProps<{ projectId: string }>();
</script>

<template>
  <FieldsDialog :project-id="projectId" inline />
</template>
