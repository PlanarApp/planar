<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Dialog, Input } from '../../ui';
import { VIEW_ICONS } from './icons';

const props = defineProps<{
  canShare: boolean;
  initial?: string;
  initialIcon?: string | null;
  title?: string;
  confirm?: string;
}>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ submit: [name: string, personal: boolean, icon: string] }>();
const { t } = useI18n();
const name = ref('');
const personal = ref(true);
const icon = ref('bookmark');
watch(open, (o) => {
  if (!o) return;
  name.value = props.initial ?? '';
  icon.value = props.initialIcon ?? 'bookmark';
  personal.value = true;
});
function submit() {
  const n = name.value.trim();
  if (!n) return;
  emit('submit', n, personal.value || !props.canShare, icon.value);
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open" :title="title ?? t('views.saved.dialogTitle')">
    <form class="flex flex-col gap-3" @submit.prevent="submit">
      <Input v-model="name" :label="t('views.saved.name')" />
      <fieldset class="flex flex-col gap-1">
        <legend class="mb-1 text-sm text-fg-muted">{{ t('views.saved.icon') }}</legend>
        <div class="flex max-h-56 flex-wrap gap-1 overflow-y-auto">
          <label
            v-for="(c, k) in VIEW_ICONS"
            :key="k"
            :class="[
              'flex size-11 cursor-pointer items-center justify-center rounded-md border has-focus-visible:outline-2 has-focus-visible:outline-focus md:size-8',
              icon === k
                ? 'border-accent bg-accent-subtle text-fg'
                : 'border-transparent text-fg-muted hover:bg-bg-muted',
            ]"
          >
            <input
              v-model="icon"
              type="radio"
              name="icon"
              :value="k"
              :aria-label="k"
              class="sr-only"
            />
            <component :is="c" :size="16" aria-hidden="true" />
          </label>
        </div>
      </fieldset>
      <fieldset v-if="initial === undefined && canShare" class="flex gap-4 text-sm">
        <label class="inline-flex items-center gap-1.5">
          <input v-model="personal" type="radio" name="scope" :value="true" />
          {{ t('views.saved.personal') }}
        </label>
        <label class="inline-flex items-center gap-1.5">
          <input v-model="personal" type="radio" name="scope" :value="false" />
          {{ t('views.saved.shared') }}
        </label>
      </fieldset>
    </form>
    <template #footer>
      <Button @click="open = false">{{ t('views.saved.cancel') }}</Button>
      <Button variant="primary" data-testid="save-view-submit" @click="submit">{{
        confirm ?? t('views.saved.create')
      }}</Button>
    </template>
  </Dialog>
</template>
