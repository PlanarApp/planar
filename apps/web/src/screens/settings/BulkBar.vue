<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, ConfirmDialog } from '../../ui';

// bulk actions on the selected rows of the settings list; danger — with confirmation
export interface BulkAction {
  id: string;
  label: string;
  danger?: boolean;
  run: () => void;
}
defineProps<{ count: number; actions: BulkAction[] }>();
const emit = defineEmits<{ clear: [] }>();
const { t } = useI18n();
const asking = ref<BulkAction | null>(null);
</script>

<template>
  <div
    v-if="count"
    class="flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg-subtle px-2 py-1 text-sm"
    data-testid="settings-bulk"
  >
    <span class="text-fg-muted">{{ t('settings.bulk.selected', { n: count }) }}</span>
    <Button
      v-for="a in actions"
      :key="a.id"
      size="sm"
      :variant="a.danger ? 'danger' : 'ghost'"
      :data-testid="`bulk-${a.id}`"
      @click="a.danger ? (asking = a) : a.run()"
      >{{ a.label }}</Button
    >
    <Button size="sm" variant="ghost" class="ml-auto" @click="emit('clear')">{{
      t('settings.bulk.clear')
    }}</Button>
    <ConfirmDialog
      :open="!!asking"
      :title="t('settings.bulk.confirm', { n: count })"
      :confirm-label="asking?.label ?? ''"
      danger
      @update:open="(v) => !v && (asking = null)"
      @confirm="asking?.run()"
    />
  </div>
</template>
