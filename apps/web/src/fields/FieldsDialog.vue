<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-vue-next';
import { FIELD_TYPES, type FieldType, type Row } from '@planar/shared';
import { mutate, newId, rankBetween } from '../sync';
import { Button, Dialog, Input, Select } from '../ui';
import { useFieldDefs } from './index';

// inline — without a window, as a section of the project settings
const props = defineProps<{ projectId: string; inline?: boolean }>();
const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();
const defs = useFieldDefs(() => props.projectId);
const name = ref('');
const type = ref<string | null>('text');
const deleting = ref<Row<'fieldDefs'> | null>(null);
const typeOptions = FIELD_TYPES.map((v) => ({ value: v, label: t(`fields.types.${v}`) }));

type Choice = { id: string; label: string; color?: string };
const choicesOf = (d: Row<'fieldDefs'>) => (d.options.choices as Choice[] | undefined) ?? [];

async function create() {
  const n = name.value.trim();
  if (!n || !type.value) return;
  name.value = '';
  await mutate('field.create', {
    id: newId(),
    projectId: props.projectId,
    name: n,
    type: type.value as FieldType,
    rank: rankBetween(defs.value?.at(-1)?.rank ?? null, null),
  });
}
const rename = (d: Row<'fieldDefs'>, v: string) => {
  const n = v.trim();
  if (n && n !== d.name) void mutate('field.update', { id: d.id, name: n });
};
function move(i: number, dir: -1 | 1) {
  const l = defs.value ?? [];
  const j = i + dir;
  if (j < 0 || j >= l.length) return;
  // between the neighbours on the side we are moving to
  const rank =
    dir < 0
      ? rankBetween(l[j - 1]?.rank ?? null, l[j].rank)
      : rankBetween(l[j].rank, l[j + 1]?.rank ?? null);
  void mutate('field.update', { id: l[i].id, rank });
}
async function remove() {
  const d = deleting.value;
  deleting.value = null;
  if (d) await mutate('field.delete', { id: d.id });
}
const setChoices = (d: Row<'fieldDefs'>, choices: Choice[]) =>
  mutate('field.update', { id: d.id, options: { ...d.options, choices } });
const editChoice = (d: Row<'fieldDefs'>, c: Choice, p: Partial<Choice>) =>
  setChoices(
    d,
    choicesOf(d).map((x) => (x.id === c.id ? { ...x, ...p } : x)),
  );
const addChoice = (d: Row<'fieldDefs'>) =>
  setChoices(d, [...choicesOf(d), { id: newId().slice(-12), label: t('fields.newChoice') }]);
const setCurrency = (d: Row<'fieldDefs'>, v: string) => {
  const currency = v.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(currency) && currency !== d.options.currency)
    void mutate('field.update', { id: d.id, options: { ...d.options, currency } });
};
const setOpen = (v: boolean) => (open.value = v);
const val = (e: Event) => (e.target as HTMLInputElement).value;
</script>

<template>
  <component
    :is="inline ? 'section' : Dialog"
    v-bind="inline ? {} : { open, title: t('fields.configure'), 'onUpdate:open': setOpen }"
  >
    <ul class="flex flex-col gap-3">
      <li
        v-for="(d, i) in defs"
        :key="d.id"
        class="flex flex-col gap-1 border-b border-border pb-2"
        data-testid="field-def"
      >
        <div class="flex items-center gap-1">
          <Input
            :model-value="d.name"
            :label="t('fields.name')"
            hide-label
            class="min-w-0 flex-1"
            @change="rename(d, val($event))"
          />
          <span class="text-xs text-fg-subtle">{{ t(`fields.types.${d.type}`) }}</span>
          <Button
            size="sm"
            variant="ghost"
            :icon="ArrowUp"
            :aria-label="t('fields.moveUp')"
            :disabled="i === 0"
            @click="move(i, -1)"
          />
          <Button
            size="sm"
            variant="ghost"
            :icon="ArrowDown"
            :aria-label="t('fields.moveDown')"
            :disabled="i === defs!.length - 1"
            @click="move(i, 1)"
          />
          <Button
            size="sm"
            variant="ghost"
            :icon="Trash2"
            :aria-label="t('fields.delete')"
            data-role="delete"
            @click="deleting = d"
          />
        </div>
        <div v-if="d.type === 'money'" class="w-32">
          <Input
            :model-value="String(d.options.currency ?? 'RUB')"
            :label="t('fields.currency')"
            @change="setCurrency(d, val($event))"
          />
        </div>
        <div v-if="d.type === 'select'" class="flex flex-col gap-1">
          <div v-for="c in choicesOf(d)" :key="c.id" class="flex items-center gap-1">
            <input
              type="color"
              :value="c.color ?? '#888888'"
              :aria-label="t('fields.choiceColor')"
              class="size-8"
              @change="editChoice(d, c, { color: val($event) })"
            />
            <Input
              :model-value="c.label"
              :label="t('fields.choiceLabel')"
              hide-label
              @change="val($event).trim() && editChoice(d, c, { label: val($event).trim() })"
            />
            <Button
              size="sm"
              variant="ghost"
              :icon="X"
              :aria-label="t('fields.delete')"
              @click="
                setChoices(
                  d,
                  choicesOf(d).filter((x) => x.id !== c.id),
                )
              "
            />
          </div>
          <div>
            <Button size="sm" :icon="Plus" data-role="add-choice" @click="addChoice(d)">{{
              t('fields.addChoice')
            }}</Button>
          </div>
        </div>
      </li>
    </ul>
    <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="create">
      <Input v-model="name" :label="t('fields.name')" class="min-w-40 flex-1" />
      <Select v-model="type" :options="typeOptions" :label="t('fields.type')" />
      <Button type="submit" :icon="Plus" data-role="create">{{ t('fields.add') }}</Button>
    </form>
    <Dialog
      :open="!!deleting"
      :title="t('fields.deleteTitle')"
      :description="t('fields.deleteText')"
      @update:open="(v) => !v && (deleting = null)"
    >
      <template #footer>
        <Button variant="ghost" @click="deleting = null">{{ t('fields.cancel') }}</Button>
        <Button variant="danger" data-testid="confirm-field-delete" @click="remove">{{
          t('fields.delete')
        }}</Button>
      </template>
    </Dialog>
  </component>
</template>
