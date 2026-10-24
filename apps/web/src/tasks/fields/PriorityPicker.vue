<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import OptionPicker from './OptionPicker.vue';
import PriorityIcon from './PriorityIcon.vue';

const props = defineProps<{ compact?: boolean }>();
const Blank = () => null;
const model = defineModel<number>({ default: 0 });
const { t } = useI18n();
const options = [0, 1, 2, 3, 4].map((p) => ({
  id: String(p),
  label: t(`tasks.priority.${p}`),
  // у «Без приоритета» значка нет (иначе «—» перед подписью), кроме compact: там триггер — один значок
  icon: p || props.compact ? PriorityIcon : Blank,
  iconProps: { priority: p },
}));
</script>

<template>
  <OptionPicker
    :options="options"
    :selected="[String(model)]"
    :title="t('tasks.priorityTitle')"
    :compact="compact"
    @pick="model = Number($event)"
  />
</template>
