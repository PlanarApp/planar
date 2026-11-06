<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Editor, EditorContent } from '@tiptap/vue-3';
import type { EditorOptions, JSONContent } from '@tiptap/vue-3';
import { Extension, InputRule, type Extensions } from '@tiptap/core';
import { editorExtensions } from '@planar/editor';
import Placeholder from '@tiptap/extension-placeholder';
import { ApiError } from '../../api/http';
import { uploadFile } from '../../api/files';
import { useAuth } from '../../auth/useAuth';
import type { RefPick } from './RefPicker.vue';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { filterSlash, slashItems } from './slash';

// link dialog (@@/@@@) — a separate chunk: the task index is built only when opened
const RefPicker = defineAsyncComponent(() => import('./RefPicker.vue'));

type Item = { id: string; label: string };
const props = withDefaults(
  defineProps<{
    modelValue?: JSONContent | null;
    members: { id: string; name: string }[];
    label: string;
    placeholder?: string;
    image?: boolean;
    editable?: boolean;
    /** Collaborative editing (P3-ydoc): document name `docs:<id>` | `task:<id>`; modelValue is not used then. */
    collab?: { name: string };
    /** @@ — link to a task, @@@ — to a document (chat) */
    refs?: boolean;
    /** a long text is clamped under "Expand" */
    collapsible?: boolean;
  }>(),
  { editable: true },
);
const emit = defineEmits<{
  'update:modelValue': [v: JSONContent | null];
  blur: [];
  submit: [];
  attach: [files: File[]]; // non-images dropped into the editor
}>();
const { t, locale } = useI18n();
const error = ref('');

// @ hint: the state is written by suggestion, we draw the list ourselves
const sug = ref<{
  items: Item[];
  index: number;
  command: (i: Item) => void;
  rect: DOMRect | null;
} | null>(null);

// suggestion render (@ — people, / — commands): the state is written to sug, the list is drawn below
const sugRender = () => {
  const set = (p: {
    items: Item[];
    command: (i: Item) => void;
    clientRect?: (() => DOMRect | null) | null;
  }) =>
    (sug.value = {
      items: p.items,
      index: 0,
      command: p.command,
      rect: p.clientRect?.() ?? null,
    });
  return {
    onStart: set,
    onUpdate: set,
    onExit: () => (sug.value = null),
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      const s = sug.value;
      if (!s || !s.items.length) return false;
      if (event.key === 'ArrowDown') s.index = (s.index + 1) % s.items.length;
      else if (event.key === 'ArrowUp') s.index = (s.index + s.items.length - 1) % s.items.length;
      else if (event.key === 'Enter') s.command(s.items[s.index]);
      else return false;
      return true;
    },
  };
};

// '/' — block menu, as in documents (PLNRAPP-91)
const fileInput = ref<HTMLInputElement>();
const Slash = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion<Item, Item>({
        editor: this.editor,
        pluginKey: new PluginKey('slashMenu'),
        char: '/',
        items: ({ query }) =>
          filterSlash(query, props.image).map((i) => ({
            id: i.id,
            label: i.title[locale.value === 'en' ? 'en' : 'ru'],
          })),
        command: ({ editor: ed, range, props: item }) => {
          ed.chain().focus().deleteRange(range).run();
          slashItems
            .find((i) => i.id === item.id)
            ?.run(ed, { pickImage: () => fileInput.value?.click() });
        },
        render: sugRender,
      }),
    ];
  },
});

// @@: the characters are removed, the dialog opens at the cursor; the choice inserts the link there
const refAt = ref<{ pos: number; rect: { left: number; top: number; bottom: number } } | null>(
  null,
);
const refTrigger = Extension.create({
  name: 'refTrigger',
  addInputRules() {
    return [
      new InputRule({
        // only a standalone @@ (start of line or after a space), not inside a word or an address
        find: /(^|\s)@@$/,
        handler: ({ range, match, chain }) => {
          const from = range.from + match[1]!.length;
          chain().deleteRange({ from, to: range.to }).run();
          const c = this.editor.view.coordsAtPos(from);
          refAt.value = { pos: from, rect: { left: c.left, top: c.top, bottom: c.bottom } };
        },
      }),
    ];
  },
});
function insertRef(r: RefPick) {
  const at = refAt.value;
  refAt.value = null;
  if (!at) return;
  editor.value
    ?.chain()
    .focus()
    .insertContentAt(at.pos, [
      { type: 'text', text: r.label, marks: [{ type: 'link', attrs: { href: r.href } }] },
      { type: 'text', text: ' ' },
    ])
    .run();
}
function closeRef() {
  refAt.value = null;
  editor.value?.commands.focus();
}

async function insertFiles(files: File[]) {
  error.value = '';
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const r = await uploadFile(f);
      editor.value
        ?.chain()
        .focus()
        .setImage({ src: `/files/${r.sha256}`, alt: f.name })
        .run();
    } catch (e) {
      error.value =
        e instanceof ApiError && e.status === 413 ? t('task.tooLarge') : t('task.uploadFailed');
    }
  }
}
const imagesOf = (list?: FileList | null) =>
  props.image ? [...(list ?? [])].filter((f) => f.type.startsWith('image/')) : [];

const { user } = useAuth();
const editor = shallowRef<Editor | null>(null);
let session: { destroy: () => void; retry: () => void } | undefined;
const unsynced = ref(false);
const retry = () => {
  unsynced.value = false;
  session?.retry();
};
let gone = false;
let readOnly = () => false;

const options = (extra: Extensions = [], collab = false): Partial<EditorOptions> => ({
  ...(collab ? {} : { content: props.modelValue ?? '' }),
  editable: props.editable,
  extensions: [
    Placeholder.configure({ placeholder: props.placeholder ?? '' }),
    ...editorExtensions({
      collab,
      image: props.image,
      suggestion: {
        char: '@',
        items: ({ query }: { query: string }): Item[] =>
          props.members
            .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map((m) => ({ id: m.id, label: m.name })),
        render: sugRender,
      },
    }),
    Slash,
    ...(props.refs ? [refTrigger] : []),
    ...extra,
  ],
  editorProps: {
    attributes: { 'aria-label': props.label, role: 'textbox', 'aria-multiline': 'true' },
    handleKeyDown: (_v, e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        emit('submit');
        return true;
      }
      return false;
    },
    handlePaste: (_v, e) => {
      const files = imagesOf(e.clipboardData?.files);
      if (files.length) void insertFiles(files);
      return files.length > 0;
    },
    handleDrop: (_v, e) => {
      const all = props.image ? [...(e.dataTransfer?.files ?? [])] : [];
      const imgs = all.filter((f) => f.type.startsWith('image/'));
      const rest = all.filter((f) => !f.type.startsWith('image/'));
      if (imgs.length) void insertFiles(imgs);
      if (rest.length) emit('attach', rest);
      return all.length > 0;
    },
  },
  onUpdate: ({ editor: ed }) => emit('update:modelValue', ed.isEmpty ? null : ed.getJSON()),
  onBlur: () => emit('blur'),
});

if (props.collab) {
  // yjs/hocuspocus — a separate chunk: not included in the initial bundle
  void import('@planar/editor/collab').then(({ openCollab }) => {
    if (gone) return;
    const c = openCollab(props.collab!.name, {
      id: user.value?.id ?? '',
      name: user.value?.name ?? '',
    });
    session = c;
    readOnly = c.readOnly;
    editor.value = new Editor(options(c.extensions, true));
    const sync = () => editor.value?.setEditable(props.editable && !readOnly());
    c.onAuthenticated(sync);
    c.onDenied(() => (unsynced.value = true));
    c.onAuthenticated(() => (unsynced.value = false));
    sync();
  });
} else editor.value = new Editor(options());

// external value — only when we are not typing (otherwise it would reset the typed text)
watch(
  () => props.modelValue,
  (v) => {
    const ed = editor.value;
    if (!ed || props.collab || ed.isFocused) return;
    if (JSON.stringify(v ?? null) !== JSON.stringify(ed.isEmpty ? null : ed.getJSON()))
      ed.commands.setContent(v ?? '', { emitUpdate: false });
  },
);
watch(
  () => props.editable,
  (v) => editor.value?.setEditable(v && !readOnly()),
);
// long text — under "Expand"; collapsed only when noticeably taller than the clamp (PLNRAPP-93)
const CLAMP = 160;
const box = ref<HTMLElement>();
const tall = ref(false);
const expanded = ref(false);
let ro: ResizeObserver | undefined;
watch(box, (el) => {
  ro?.disconnect();
  if (!el || !props.collapsible || typeof ResizeObserver === 'undefined') return;
  const content = el.firstElementChild!;
  ro = new ResizeObserver(() => (tall.value = content.scrollHeight > CLAMP * 1.25));
  ro.observe(content);
});
// an image (a thumbnail too) opens the original: a click when reading, a double click when editing
function openImage(e: MouseEvent) {
  const img = e.target as HTMLElement;
  if (img.tagName !== 'IMG' || (editor.value?.isEditable && e.detail < 2)) return;
  window.open((img as HTMLImageElement).src, '_blank', 'noopener');
}
onBeforeUnmount(() => {
  gone = true;
  ro?.disconnect();
  editor.value?.destroy();
  session?.destroy();
});

defineExpose({
  editor,
  insertFiles,
  clear: () => editor.value?.commands.clearContent(true),
  focus: () => editor.value?.commands.focus('end'),
});
// the @ list under the cursor; does not fit below (field near the bottom edge, as in chat) — above the cursor
const sugStyle = (r: DOMRect | null, n: number) => {
  if (!r) return {};
  const h = Math.min(256, n * 32 + 10);
  return r.bottom + 4 + h > window.innerHeight
    ? { left: r.left + 'px', bottom: window.innerHeight - r.top + 4 + 'px' }
    : { left: r.left + 'px', top: r.bottom + 4 + 'px' };
};
</script>

<template>
  <div class="task-editor relative">
    <div
      ref="box"
      :class="tall && !expanded && 'collapsed'"
      :style="tall && !expanded ? { maxHeight: `${CLAMP}px` } : undefined"
      @focusin="expanded = true"
      @click="openImage"
    >
      <EditorContent :editor="editor ?? undefined" />
    </div>
    <button
      v-if="tall"
      type="button"
      class="mt-1 text-sm text-accent outline-none hover:underline focus-visible:ring-2 ring-focus"
      data-testid="editor-expand"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      {{ t(expanded ? 'task.collapseComment' : 'task.expandComment') }}
    </button>
    <input
      v-if="image"
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="
        (e) => {
          void insertFiles([...((e.target as HTMLInputElement).files ?? [])]);
          (e.target as HTMLInputElement).value = '';
        }
      "
    />
    <p v-if="error" role="alert" class="mt-1 text-xs text-danger">{{ error }}</p>
    <p
      v-if="unsynced"
      role="status"
      data-testid="unsynced"
      class="mt-1 flex items-center gap-2 text-xs text-warning"
    >
      {{ t('task.unsynced') }}
      <button type="button" class="underline" @click="retry">
        {{ t('task.retry') }}
      </button>
    </p>
    <ul
      v-if="sug && sug.items.length"
      role="listbox"
      :aria-label="t('task.mention')"
      class="fixed z-50 max-h-64 min-w-44 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-md"
      :style="sugStyle(sug.rect, sug.items.length)"
    >
      <li
        v-for="(it, i) in sug.items"
        :key="it.id"
        role="option"
        :aria-selected="i === sug.index"
        :class="[
          'flex h-8 cursor-default items-center rounded-sm px-2 text-base text-fg',
          i === sug.index && 'bg-bg-muted',
        ]"
        @mousedown.prevent="sug.command(it)"
      >
        {{ it.label }}
      </li>
    </ul>
    <RefPicker v-if="refAt" :rect="refAt.rect" @pick="insertRef" @close="closeRef" />
  </div>
</template>

<style>
.task-editor .ProseMirror {
  outline: none;
  min-height: 1.5rem;
  overflow-wrap: anywhere;
}
.task-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: var(--color-fg-subtle);
}
.task-editor .ProseMirror ul:not([data-type='taskList']) {
  list-style: disc;
  padding-left: 1.25rem;
}
.task-editor .ProseMirror ol {
  list-style: decimal;
  padding-left: 1.25rem;
}
.task-editor .ProseMirror ul[data-type='taskList'] {
  list-style: none;
  padding-left: 0;
}
.task-editor .ProseMirror ul[data-type='taskList'] li {
  display: flex;
  gap: 0.5rem;
}
.task-editor .ProseMirror ul[data-type='taskList'] li > div {
  flex: 1;
}
.task-editor .ProseMirror h1,
.task-editor .ProseMirror h2,
.task-editor .ProseMirror h3 {
  font-weight: 600;
  margin: 0.75rem 0 0.25rem;
}
.task-editor .ProseMirror h1 {
  font-size: var(--text-2xl);
}
.task-editor .ProseMirror h2 {
  font-size: var(--text-xl);
}
.task-editor .ProseMirror h3 {
  font-size: var(--text-lg);
}
.task-editor .ProseMirror table {
  border-collapse: collapse;
  width: 100%;
  table-layout: fixed;
}
.task-editor .ProseMirror th,
.task-editor .ProseMirror td {
  border: 1px solid var(--color-border-strong);
  padding: 0.25rem 0.5rem;
  vertical-align: top;
}
.task-editor .ProseMirror th {
  background: var(--color-bg-muted);
  font-weight: 600;
  text-align: left;
}
.task-editor .ProseMirror code {
  font-family: var(--font-mono);
  background: var(--color-bg-muted);
  border-radius: var(--radius-sm);
  padding: 0 0.25rem;
}
.task-editor .ProseMirror pre {
  font-family: var(--font-mono);
  background: var(--color-bg-muted);
  border-radius: var(--radius-md);
  padding: 0.5rem;
  overflow-x: auto;
}
.task-editor .ProseMirror blockquote {
  border-left: 2px solid var(--color-border-strong);
  padding-left: 0.75rem;
  color: var(--color-fg-muted);
}
.task-editor .ProseMirror img {
  max-width: 100%;
  border-radius: var(--radius-md);
}
/* several images in a row — thumbnails side by side (PLNRAPP-93) */
.task-editor .ProseMirror img:has(+ img),
.task-editor .ProseMirror img + img {
  display: inline-block;
  width: 8rem;
  height: 8rem;
  object-fit: cover;
  margin: 0 0.25rem 0.25rem 0;
  cursor: zoom-in;
}
.task-editor .collapsed {
  overflow: hidden;
  mask-image: linear-gradient(to bottom, #000 75%, transparent);
}
.task-editor .mention {
  color: var(--color-accent);
  font-weight: 500;
}
.task-editor .collaboration-carets__caret {
  position: relative;
  margin: 0 -1px;
  border-left: 1px solid;
  border-right: 1px solid;
  word-break: normal;
  pointer-events: none;
}
.task-editor .collaboration-carets__label {
  position: absolute;
  top: -1.4em;
  left: -1px;
  padding: 0 0.25rem;
  border-radius: var(--radius-sm);
  color: #fff;
  font-size: 0.7rem;
  line-height: 1.3;
  white-space: nowrap;
  user-select: none;
}
</style>
