<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import {
  CheckCircle2,
  Circle,
  MessageSquareReply,
  Pencil,
  Trash2,
  UserPlus,
} from 'lucide-vue-next';
import type { JSONContent } from '@tiptap/vue-3';
import type { Row } from '@planar/shared';
import {
  Avatar,
  Button,
  Editor,
  IconButton,
  Menu,
  db,
  mutate,
  newId,
  useProjectAdmin,
  useQuery,
  useSession,
  type MenuItem,
} from '@planar/web/modules';
import { canResolve, threads, type CommentRow } from './comments';
import { useTexts } from './text';

// PLNRAPP-209: comments on a page — threads, mentions, assignment to a person, resolve (as task comments)
const props = defineProps<{ pageId: string; spaceId: string; projectId: string | null }>();
const tx = useTexts();
const route = useRoute();
const me = useSession();
const isAdmin = useProjectAdmin();

const rows = useQuery(() =>
  db.table<CommentRow>('docsComments').where('pageId').equals(props.pageId).toArray(),
);
const list = computed(() => threads(rows.value ?? []));
const count = computed(() => rows.value?.length ?? 0);

// people of the space: mentions — everyone, assignment — not guests (the mutator checks the same);
// not the AI bot either: comments on pages have no AI yet, an assignment to it would hang
const people = useQuery(async () => {
  const ms = await db
    .table<Row<'spaceMembers'>>('spaceMembers')
    .where('spaceId')
    .equals(props.spaceId)
    .toArray();
  const us = await db.table<Row<'users'>>('users').bulkGet(ms.map((m) => m.userId));
  return ms
    .flatMap((m, i) => {
      const u = us[i];
      return u && !u.deactivatedAt
        ? [
            {
              id: u.id,
              name: u.name,
              avatar: u.avatarFile ? `/files/${u.avatarFile}/preview?w=256` : null,
              role: m.role,
              bot: !!u.bot,
            },
          ]
        : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});
const members = computed(() => people.value ?? []);
const assignable = computed(() => members.value.filter((m) => m.role !== 'guest' && !m.bot));
const myRole = computed(() => members.value.find((m) => m.id === me.value?.id)?.role);
const canWrite = computed(() => !!myRole.value && myRole.value !== 'guest');
const admin = computed(() => isAdmin(props.spaceId, props.projectId));
const nameOf = (id: string | null) => members.value.find((m) => m.id === id)?.name ?? '?';
const avatarOf = (id: string | null) => members.value.find((m) => m.id === id)?.avatar ?? null;

const draft = shallowRef<JSONContent | null>(null); // shallow: reactive proxies can't be stored in IndexedDB
const replyTo = ref<string | null>(null);
const replyDraft = shallowRef<JSONContent | null>(null);
const editing = ref<string | null>(null);
const editDraft = shallowRef<JSONContent | null>(null);

const send = (body: JSONContent, parentId: string | null = null) =>
  mutate('docs.comment.create', { id: newId(), pageId: props.pageId, body, parentId }).catch(
    () => {},
  );
async function post() {
  if (!draft.value) return;
  const body = draft.value;
  draft.value = null;
  await send(body);
}
async function reply() {
  if (!replyDraft.value || !replyTo.value) return;
  const body = replyDraft.value;
  const parentId = replyTo.value;
  replyDraft.value = null;
  replyTo.value = null;
  await send(body, parentId);
}
function startReply(c: CommentRow) {
  replyDraft.value = null;
  replyTo.value = c.id;
}
function startEdit(c: CommentRow) {
  editDraft.value = c.body as JSONContent;
  editing.value = c.id;
}
async function saveEdit() {
  if (!editing.value || !editDraft.value) return;
  const id = editing.value;
  editing.value = null;
  await mutate('docs.comment.update', { id, body: editDraft.value }).catch(() => {});
}
const remove = (c: CommentRow) => mutate('docs.comment.delete', { id: c.id }).catch(() => {});
const assign = (c: CommentRow, assigneeId: string | null) =>
  mutate('docs.comment.assign', { id: c.id, assigneeId }).catch(() => {});
const resolve = (c: CommentRow) =>
  mutate('docs.comment.resolve', { id: c.id, resolved: !c.resolvedAt }).catch(() => {});
const assignItems = (c: CommentRow): MenuItem[] => [
  ...assignable.value.map((m) => ({
    id: m.id,
    label: m.name,
    icon: Avatar,
    iconProps: { name: m.name, src: m.avatar, size: 'xs' },
    onSelect: () => void assign(c, m.id),
  })),
  ...(c.assigneeId
    ? [
        { separator: true as const },
        { id: 'none', label: tx('unassign'), onSelect: () => void assign(c, null) },
      ]
    : []),
];

// a link from a notification (?comment=<id>) scrolls to the comment
const root = ref<HTMLElement>();
onMounted(async () => {
  const id = route?.query.comment;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return;
  for (let i = 0; i < 20 && !rows.value; i++) await new Promise((r) => setTimeout(r, 50));
  await nextTick();
  root.value?.querySelector(`[data-comment="${id}"]`)?.scrollIntoView({ block: 'center' });
});
</script>

<template>
  <section ref="root" class="mt-6 flex flex-col gap-3" data-testid="doc-comments">
    <h2 class="text-base font-semibold">
      {{ tx('comments') }}<span v-if="count" class="ml-1 text-fg-subtle">{{ count }}</span>
    </h2>
    <div v-for="t in list" :key="t.root.id" class="flex flex-col gap-2" data-testid="doc-thread">
      <div
        v-for="c in [t.root, ...t.replies]"
        :key="c.id"
        :class="[
          'flex flex-col',
          c.parentId && 'ml-8 border-l-2 border-border pl-3',
          c.assigneeId &&
            'overflow-hidden rounded-lg border ' +
              (c.resolvedAt ? 'border-border opacity-75' : 'border-accent/40'),
        ]"
        data-testid="doc-comment"
        :data-comment="c.id"
      >
        <div
          v-if="c.assigneeId"
          :class="[
            'flex flex-wrap items-center gap-2 px-2 py-1 text-xs',
            c.resolvedAt ? 'bg-bg-muted text-fg-muted' : 'bg-accent-subtle',
          ]"
          data-testid="doc-comment-assigned"
        >
          <Button
            size="sm"
            :variant="c.resolvedAt ? 'ghost' : 'secondary'"
            :icon="c.resolvedAt ? CheckCircle2 : Circle"
            :aria-pressed="!!c.resolvedAt"
            :disabled="!canResolve(c, me?.id, admin)"
            data-testid="doc-comment-resolve"
            @click="resolve(c)"
          >
            {{ tx(c.resolvedAt ? 'resolved' : 'resolve') }}
          </Button>
          <span class="ml-auto inline-flex min-w-0 items-center gap-1">
            <Avatar :name="nameOf(c.assigneeId)" :src="avatarOf(c.assigneeId)" size="sm" />
            <span class="truncate font-medium">{{ nameOf(c.assigneeId) }}</span>
          </span>
        </div>
        <div :class="['flex gap-2', c.assigneeId && 'p-2']">
          <Avatar :name="nameOf(c.authorId)" :src="avatarOf(c.authorId)" size="md" />
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
              <span class="font-medium">{{ nameOf(c.authorId) }}</span>
              <time class="whitespace-nowrap text-xs text-fg-subtle" :datetime="c.createdAt">
                {{ new Date(c.createdAt).toLocaleString() }}
              </time>
              <span v-if="c.editedAt" class="text-xs text-fg-subtle">{{ tx('edited') }}</span>
            </div>
            <template v-if="editing === c.id">
              <Editor
                v-model="editDraft"
                refs
                :members="members"
                :label="tx('comment')"
                @submit="saveEdit"
              />
              <div class="mt-1 flex gap-2">
                <Button size="sm" variant="primary" @click="saveEdit">{{ tx('save') }}</Button>
                <Button size="sm" variant="ghost" @click="editing = null">{{
                  tx('cancel')
                }}</Button>
              </div>
            </template>
            <template v-else>
              <Editor
                :model-value="c.body as JSONContent"
                :members="members"
                :label="tx('comment')"
                :editable="false"
                collapsible
              />
              <div v-if="canWrite" class="mt-1 flex items-center gap-1">
                <IconButton
                  size="sm"
                  :icon="MessageSquareReply"
                  :label="tx('reply')"
                  data-testid="doc-comment-reply"
                  @click="startReply(c)"
                />
                <Menu v-if="assignable.length" :items="assignItems(c)" align="start">
                  <template #trigger>
                    <IconButton
                      size="sm"
                      :icon="UserPlus"
                      :label="tx('assign')"
                      data-testid="doc-comment-assign"
                    />
                  </template>
                </Menu>
                <template v-if="c.authorId === me?.id">
                  <IconButton
                    size="sm"
                    :icon="Pencil"
                    :label="tx('edit')"
                    data-testid="doc-comment-edit"
                    @click="startEdit(c)"
                  />
                  <IconButton
                    size="sm"
                    :icon="Trash2"
                    :label="tx('delete')"
                    data-testid="doc-comment-delete"
                    @click="remove(c)"
                  />
                </template>
              </div>
            </template>
          </div>
        </div>
      </div>
      <div
        v-if="replyTo && [t.root, ...t.replies].some((c) => c.id === replyTo)"
        class="ml-8 rounded-md border border-border-strong bg-bg p-2"
        data-testid="doc-reply-box"
      >
        <Editor
          refs
          :model-value="replyDraft"
          :members="members"
          :label="tx('replyPlaceholder')"
          :placeholder="tx('replyPlaceholder')"
          @update:model-value="(v) => (replyDraft = v)"
          @submit="reply"
        />
        <div class="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" @click="replyTo = null">{{ tx('cancel') }}</Button>
          <Button
            size="sm"
            variant="primary"
            :disabled="!replyDraft"
            data-testid="doc-reply-send"
            @click="reply"
            >{{ tx('send') }}</Button
          >
        </div>
      </div>
    </div>
    <div v-if="canWrite" class="rounded-md border border-border-strong bg-bg p-2">
      <Editor
        refs
        :model-value="draft"
        :members="members"
        :label="tx('commentPlaceholder')"
        :placeholder="tx('commentPlaceholder')"
        @update:model-value="(v) => (draft = v)"
        @submit="post"
      />
      <div class="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="primary"
          :disabled="!draft"
          data-testid="doc-comment-send"
          @click="post"
          >{{ tx('send') }}</Button
        >
      </div>
    </div>
  </section>
</template>
