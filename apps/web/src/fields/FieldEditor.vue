<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { fieldValueSchema, type Row } from '@planar/shared';
import { DueDatePicker, useMembers } from '../tasks';
import { UserPicker } from '../pickers';
import { X } from 'lucide-vue-next';
import { IconButton, Input, Select } from '../ui';

const props = defineProps<{ def: Row<'fieldDefs'>; value?: unknown; spaceId: string }>();
const emit = defineEmits<{ 'update:value': [value: unknown | null] }>();
const { t } = useI18n();
const members = useMembers(() => props.spaceId);

const show = (v: unknown) =>
  v === undefined || v === null
    ? ''
    : props.def.type === 'money'
      ? String((v as number) / 100)
      : String(v);
const draft = ref(show(props.value));
const invalid = ref(false);
// last written text: Enter and the change after it don't write twice
let last = draft.value;
watch(
  () => props.value,
  (v) => {
    draft.value = last = show(v);
    invalid.value = false;
  },
);

/** Check by the type schema: an invalid value is not emitted. */
function commit(v: unknown | null) {
  if (v !== null && !fieldValueSchema(props.def as never).safeParse(v).success) {
    invalid.value = true;
    return;
  }
  invalid.value = false;
  emit('update:value', v);
}
function commitDraft() {
  const s = draft.value.trim();
  if (s === last.trim()) return;
  if (!s) {
    last = draft.value;
    return commit(null);
  }
  const type = props.def.type;
  if (type === 'number' || type === 'money') {
    const x = Number(s.replace(',', '.'));
    if (!Number.isFinite(x)) {
      invalid.value = true;
      return;
    }
    last = draft.value;
    return commit(type === 'money' ? Math.round(x * 100) : x);
  }
  last = draft.value;
  commit(s);
}

const choices = computed(() =>
  ((props.def.options.choices as { id: string; label: string; color?: string }[]) ?? []).map(
    (c) => ({ value: c.id, label: c.label, color: c.color }),
  ),
);
</script>

<template>
  <div class="flex items-center gap-1" data-testid="field-editor">
    <DueDatePicker
      v-if="def.type === 'date'"
      :model-value="typeof value === 'string' ? value : null"
      @update:model-value="commit"
    />
    <template v-else-if="def.type === 'select' || def.type === 'user'">
      <UserPicker
        v-if="def.type === 'user'"
        :users="members ?? []"
        :selected="typeof value === 'string' ? [value] : []"
        :title="def.name"
        empty="—"
        field
        @pick="(v) => v && commit(v)"
      />
      <Select
        v-else
        :model-value="typeof value === 'string' ? value : null"
        :options="choices"
        :label="def.name"
        :placeholder="'—'"
        @update:model-value="(v) => v && commit(v)"
      />
    </template>
    <Input
      v-else
      v-model="draft"
      :label="def.name"
      hide-label
      :error="invalid ? t('fields.invalid') : undefined"
      @change="commitDraft"
      @keydown.enter="commitDraft"
    />
    <IconButton
      v-if="value != null && (def.type === 'date' || def.type === 'select' || def.type === 'user')"
      :icon="X"
      :label="t('fields.clear')"
      size="sm"
      data-testid="field-clear"
      @click="commit(null)"
    />
  </div>
</template>
