<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { fieldValueSchema, type Row } from '@planar/shared';
import { DueDatePicker, useMembers } from '../tasks';
import { Button, Input, Select } from '../ui';

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
// последний записанный текст: Enter и следом change не пишут дважды
let last = draft.value;
watch(
  () => props.value,
  (v) => {
    draft.value = last = show(v);
    invalid.value = false;
  },
);

/** Проверка по схеме типа: неверное не эмитится. */
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
const users = computed(() => (members.value ?? []).map((u) => ({ value: u.id, label: u.name })));
</script>

<template>
  <div class="flex items-center gap-1" data-testid="field-editor">
    <DueDatePicker
      v-if="def.type === 'date'"
      :model-value="typeof value === 'string' ? value : null"
      @update:model-value="commit"
    />
    <template v-else-if="def.type === 'select' || def.type === 'user'">
      <Select
        :model-value="typeof value === 'string' ? value : null"
        :options="def.type === 'select' ? choices : users"
        :label="def.name"
        :placeholder="'—'"
        @update:model-value="(v) => v && commit(v)"
      />
      <Button v-if="value != null" size="sm" variant="ghost" @click="commit(null)">{{
        t('fields.clear')
      }}</Button>
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
  </div>
</template>
