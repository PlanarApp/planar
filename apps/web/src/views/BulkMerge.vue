<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Dialog, Tooltip } from '../ui';
import { toast } from '../ui/toast';
import type { TaskView } from '../tasks';
import { descendantsOfSelected, mergeTasks, parentInReplica } from '../tasks/merge';
import { useSelection } from './selection';

/**
 * PLNRAPP-117: bulk merge — of 2+ selected tasks the user marks the target, the rest merge into it.
 * Tasks of different spaces cannot be merged; a descendant of another selected task cannot be the target.
 */
const props = defineProps<{ tasks: readonly TaskView[] }>();
const { t } = useI18n();
const sel = useSelection();
const open = ref(false);
const targetId = ref<string | null>(null);
const blocked = ref<ReadonlySet<string>>(new Set());
const busy = ref(false);
const oneSpace = computed(() => new Set(props.tasks.map((x) => x.spaceId)).size === 1);
const target = computed(() => props.tasks.find((x) => x.id === targetId.value));
const rest = computed(() => props.tasks.filter((x) => x.id !== targetId.value));

watch(open, async (o) => {
  if (!o) return;
  targetId.value = null;
  blocked.value = await descendantsOfSelected(
    props.tasks.map((x) => x.id),
    parentInReplica,
  );
});

async function merge() {
  const to = target.value;
  if (!to) return;
  busy.value = true;
  try {
    await mergeTasks(
      rest.value.map((x) => x.id),
      to.id,
    );
    toast(t('merge.bulkDone', { n: rest.value.length, to: to.key }), 3000);
    open.value = false;
    sel.clear();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <template v-if="tasks.length >= 2">
    <Button v-if="oneSpace" size="sm" data-testid="bulk-merge" @click="open = true">{{
      t('merge.bulk')
    }}</Button>
    <Tooltip v-else :content="t('merge.bulkSpaces')">
      <span tabindex="0" :title="t('merge.bulkSpaces')">
        <Button size="sm" disabled data-testid="bulk-merge">{{ t('merge.bulk') }}</Button>
      </span>
    </Tooltip>
  </template>
  <Dialog
    v-model:open="open"
    size="md"
    :title="t('merge.bulkTitle')"
    :description="t('merge.bulkText')"
  >
    <ul class="max-h-[40vh] overflow-y-auto" role="radiogroup" :aria-label="t('merge.target')">
      <li v-for="x in tasks" :key="x.id">
        <label
          :class="[
            'flex min-h-11 items-center gap-2 rounded-md px-2 md:min-h-8',
            blocked.has(x.id)
              ? 'cursor-not-allowed opacity-60'
              : 'cursor-pointer hover:bg-bg-muted',
          ]"
          :title="blocked.has(x.id) ? t('merge.bulkDescendant') : undefined"
          data-testid="merge-target"
        >
          <input
            v-model="targetId"
            type="radio"
            name="merge-target"
            :value="x.id"
            :disabled="blocked.has(x.id)"
          />
          <span class="text-xs text-fg-subtle">{{ x.key }}</span>
          <span class="flex-1 truncate">{{ x.title }}</span>
          <span v-if="blocked.has(x.id)" class="text-xs text-fg-muted">{{
            t('merge.bulkDescendant')
          }}</span>
        </label>
      </li>
    </ul>
    <p v-if="target" class="text-sm text-fg-muted" data-testid="merge-summary">
      {{ t('merge.bulkConfirm', { n: rest.length, to: target.key }) }}
    </p>
    <template #footer>
      <Button @click="open = false">{{ t('ui.cancel') }}</Button>
      <Button
        variant="primary"
        :disabled="!target || busy"
        data-testid="merge-confirm"
        @click="merge"
        >{{ t('merge.action') }}</Button
      >
    </template>
  </Dialog>
</template>
