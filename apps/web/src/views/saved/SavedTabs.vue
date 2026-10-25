<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Bookmark, MoreHorizontal } from 'lucide-vue-next';
import { Button, Dialog, Menu } from '../../ui';
import { deleteView, updateView } from './ops';
import { useCanShare, useSavedViews, type SavedView } from './queries';
import SaveViewDialog from './SaveViewDialog.vue';

const props = defineProps<{ spaceId: string; projectId: string; activeId?: string }>();
const { t } = useI18n();
const router = useRouter();
const views = useSavedViews(() => props.spaceId);
const canShare = useCanShare(() => props.spaceId);

const renaming = ref<SavedView | null>(null);
const renameOpen = ref(false);
const deleting = ref<SavedView | null>(null);
const deleteOpen = ref(false);

// личный вид — всегда свой; общий правит участник с правом member
const editable = (v: SavedView) => v.userId !== null || canShare.value;
const items = (v: SavedView) => [
  {
    id: 'rename',
    label: t('views.saved.rename'),
    onSelect: () => ((renaming.value = v), (renameOpen.value = true)),
  },
  {
    id: 'delete',
    label: t('views.saved.delete'),
    danger: true,
    onSelect: () => ((deleting.value = v), (deleteOpen.value = true)),
  },
];
const open = (v: SavedView) =>
  void router.push(`/p/${encodeURIComponent(props.projectId)}/v/${encodeURIComponent(v.id)}`);
async function confirmDelete() {
  deleteOpen.value = false;
  const v = deleting.value;
  if (!v) return;
  await deleteView(v.id);
  if (v.id === props.activeId) void router.push(`/p/${encodeURIComponent(props.projectId)}`);
}
</script>

<template>
  <div
    v-for="v in views"
    :key="v.id"
    class="inline-flex shrink-0 items-center rounded-md"
    :class="v.id === activeId ? 'bg-bg-muted text-fg' : 'text-fg-muted hover:bg-bg-subtle'"
  >
    <button
      role="tab"
      type="button"
      :aria-selected="v.id === activeId"
      :data-saved-view="v.id"
      class="inline-flex h-11 md:h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-2 ring-focus"
      @click="open(v)"
    >
      <Bookmark :size="16" aria-hidden="true" />
      {{ v.name }}
    </button>
    <Menu v-if="editable(v)" :items="items(v)">
      <template #trigger>
        <button
          type="button"
          :aria-label="`${t('views.saved.menu')}: ${v.name}`"
          class="inline-flex h-11 w-8 md:h-7 items-center justify-center rounded-md outline-none focus-visible:ring-2 ring-focus"
        >
          <MoreHorizontal :size="14" aria-hidden="true" />
        </button>
      </template>
    </Menu>
  </div>

  <SaveViewDialog
    v-model:open="renameOpen"
    :can-share="false"
    :initial="renaming?.name ?? ''"
    :title="t('views.saved.rename')"
    :confirm="t('views.saved.saveChanges')"
    @submit="(name) => renaming && updateView(renaming.id, { name })"
  />
  <Dialog
    v-model:open="deleteOpen"
    :title="t('views.saved.deleteTitle')"
    :description="deleting?.name"
  >
    <template #footer>
      <Button @click="deleteOpen = false">{{ t('views.saved.cancel') }}</Button>
      <Button variant="danger" data-testid="confirm-delete-view" @click="confirmDelete">{{
        t('views.saved.delete')
      }}</Button>
    </template>
  </Dialog>
</template>
