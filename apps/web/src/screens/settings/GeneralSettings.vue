<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { Smile } from 'lucide-vue-next';
import { UserPicker } from '../../pickers';
import { Button, EmojiPicker, Input, Popover, Select } from '../../ui';
import NodeIcon from '../../ui/NodeIcon.vue';
import { uploadFile } from '../../api/files';
import { db, mutate, useQuery } from '../../sync';
import { useMembers, useWorkspace } from '../../tasks';
import ColorPicker from './ColorPicker.vue';
import SectionHeader from './SectionHeader.vue';
import { firstGrapheme, KEY_RE, useAction } from './shared';

// the first group settings section — the node's own parameters: name, colour, icon
const props = defineProps<{
  level?: 'workspace' | 'space' | 'project';
  spaceId?: string;
  projectId?: string;
}>();
const { t } = useI18n();
const { error, run } = useAction();
const ws = useWorkspace();
const row = useQuery(async () =>
  props.level === 'project' && props.projectId
    ? await db.table<Row<'projects'>>('projects').get(props.projectId)
    : props.level === 'space' && props.spaceId
      ? await db.table<Row<'spaces'>>('spaces').get(props.spaceId)
      : undefined,
);
const node = computed(() =>
  !props.level || props.level === 'workspace'
    ? { name: ws.value.name, color: ws.value.color, icon: ws.value.icon }
    : row.value
      ? { name: row.value.name, color: row.value.color, icon: row.value.icon }
      : undefined,
);
function save(patch: { name?: string; color?: string | null; icon?: string | null; mfa?: string }) {
  const n = node.value;
  if (!n) return;
  if (patch.name !== undefined && !patch.name.trim()) return;
  void run(() =>
    props.level === 'project'
      ? mutate('project.update', { id: props.projectId!, ...patch })
      : props.level === 'space'
        ? mutate('space.update', { id: props.spaceId!, ...patch })
        : mutate('settings.set', {
            id: 'workspace',
            value: { ...n, mfa: ws.value.mfa, ...patch },
          }),
  );
}
// lead (space, project) and the default assignee of new tasks (project): a space member or nobody
const members = useMembers(() => props.spaceId ?? '');
const lead = computed(() => (row.value as { leadId?: string | null } | undefined)?.leadId ?? null);
const defaultAssignee = computed(
  () => (row.value as { defaultAssigneeId?: string | null } | undefined)?.defaultAssigneeId ?? null,
);
function setPerson(field: 'leadId' | 'defaultAssigneeId', v: string | null) {
  const id = v || null;
  void run(() =>
    props.level === 'project'
      ? mutate('project.update', { id: props.projectId!, [field]: id })
      : mutate('space.update', { id: props.spaceId!, leadId: id }),
  );
}
// project key: task keys are computed from it, so a change renames every task of the project
const projectKey = computed(() => (row.value as { key?: string } | undefined)?.key ?? '');
const keyError = ref('');
async function saveKey(e: Event) {
  const input = e.target as HTMLInputElement;
  const key = input.value.trim().toUpperCase();
  keyError.value = '';
  if (key === projectKey.value) return;
  if (!KEY_RE.test(key)) return void (keyError.value = t('settings.keyInvalid'));
  // the server's unique index is the guard; a visible duplicate gets a clear message here
  if (
    await db
      .table<Row<'projects'>>('projects')
      .filter((p) => p.key === key)
      .count()
  )
    return void (keyError.value = t('settings.general.keyTaken'));
  void run(() => mutate('project.update', { id: props.projectId!, key }));
}
const emojiOpen = ref(false);
function pickEmoji(emoji: string) {
  emojiOpen.value = false;
  save({ icon: firstGrapheme(emoji) || null });
}
const val = (e: Event) => (e.target as HTMLInputElement).value;
const fileInput = ref<HTMLInputElement>();
function upload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void run(async () => save({ icon: `file:${(await uploadFile(file)).sha256}` }));
}
</script>

<template>
  <section class="flex max-w-xl flex-col gap-4" data-testid="general-settings">
    <SectionHeader :title="t(`settings.general.${level ?? 'workspace'}`)" />
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
    <template v-if="node">
      <Input
        :model-value="node.name"
        :label="t('settings.general.name')"
        data-testid="general-name"
        @change="save({ name: val($event).trim() })"
      />
      <div v-if="level === 'project'">
        <Input
          :model-value="projectKey"
          :label="t('settings.key')"
          :error="keyError"
          maxlength="10"
          data-testid="general-key"
          @input="($event.target as HTMLInputElement).value = val($event).toUpperCase()"
          @change="saveKey"
        />
        <p class="mt-1 text-xs text-fg-muted">{{ t('settings.general.keyHint') }}</p>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-sm text-fg-muted">{{ t('settings.general.color') }}</span>
        <ColorPicker
          clearable
          :model-value="node.color ?? ''"
          @update:model-value="save({ color: $event || null })"
        />
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-sm text-fg-muted">{{ t('settings.general.icon') }}</span>
        <div class="flex items-center gap-2">
          <!-- картинка вместо эмодзи; убрать картинку — снова ввод эмодзи -->
          <template v-if="node.icon?.startsWith('file:')">
            <span class="size-11 overflow-hidden rounded-md" data-testid="general-icon-image"
              ><NodeIcon :icon="node.icon"
            /></span>
            <Button size="sm" variant="ghost" @click="save({ icon: null })">{{
              t('settings.general.iconRemove')
            }}</Button>
          </template>
          <template v-else>
            <div class="w-16">
              <Input
                :model-value="node.icon ?? ''"
                :label="t('settings.general.icon')"
                hide-label
                :placeholder="t('settings.general.iconHint')"
                class="text-center"
                data-testid="general-icon"
                @change="save({ icon: firstGrapheme(val($event).trim()) || null })"
              />
            </div>
            <Popover v-model:open="emojiOpen" align="start">
              <template #trigger>
                <Button
                  size="sm"
                  :icon="Smile"
                  compact
                  :aria-label="t('settings.general.iconPick')"
                  data-testid="general-icon-pick"
                  >{{ t('settings.general.iconPick') }}</Button
                >
              </template>
              <EmojiPicker v-if="emojiOpen" @pick="pickEmoji" />
            </Popover>
            <Button size="sm" @click="fileInput?.click()">{{
              t('settings.general.iconUpload')
            }}</Button>
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              class="sr-only"
              tabindex="-1"
              @change="upload"
            />
          </template>
        </div>
      </div>
      <template v-if="level === 'space' || level === 'project'">
        <div class="flex flex-col gap-1" data-testid="general-lead">
          <span class="text-sm text-fg-muted">{{ t('settings.general.lead') }}</span>
          <UserPicker
            :users="members ?? []"
            :selected="lead ? [lead] : []"
            :title="t('settings.general.lead')"
            :none="t('settings.general.nobody')"
            field
            @pick="setPerson('leadId', $event)"
          />
        </div>
        <div
          v-if="level === 'project'"
          class="flex flex-col gap-1"
          data-testid="general-default-assignee"
        >
          <span class="text-sm text-fg-muted">{{ t('settings.general.defaultAssignee') }}</span>
          <UserPicker
            :users="members ?? []"
            :selected="defaultAssignee ? [defaultAssignee] : []"
            :title="t('settings.general.defaultAssignee')"
            :none="t('settings.general.nobody')"
            field
            @pick="setPerson('defaultAssigneeId', $event)"
          />
          <p class="mt-1 text-xs text-fg-muted">{{ t('settings.general.defaultAssigneeHint') }}</p>
        </div>
      </template>
      <div
        v-if="!level || level === 'workspace'"
        class="flex flex-col gap-1"
        data-testid="mfa-policy"
      >
        <span class="text-sm text-fg-muted">{{ t('security.policy') }}</span>
        <Select
          :model-value="ws.mfa"
          :label="t('security.policy')"
          :options="
            (['off', 'admins', 'all'] as const).map((v) => ({
              value: v,
              label: t(`security.policy_${v}`),
            }))
          "
          @update:model-value="(v) => v && save({ mfa: v })"
        />
        <p class="mt-1 text-xs text-fg-muted">{{ t('security.policyHint') }}</p>
      </div>
    </template>
  </section>
</template>
