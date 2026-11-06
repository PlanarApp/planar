<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Editor, EditorContent, Extension } from '@tiptap/vue-3';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import { editorExtensions } from '@planar/editor';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import {
  filterSlash,
  i18n,
  uploadFile,
  useSearch,
  useSession,
  type SlashItem,
} from '@planar/web/modules';
import { suggestRender, type SugState } from './suggest';
import { useTexts } from './text';

const props = withDefaults(
  defineProps<{
    /** Yjs document name: `docs:<pageId>` (P3-ydoc). */
    name: string;
    members: { id: string; name: string }[];
    editable?: boolean;
  }>(),
  { editable: true },
);
const emit = defineEmits<{ 'open-task': [ref: string] }>();
const user = useSession();
const tx = useTexts();
const error = ref('');
const sug = ref<SugState | null>(null);
const fileInput = ref<HTMLInputElement>();
const render = suggestRender(sug);
const tasks = useSearch();

async function insertImages(files: File[]) {
  error.value = '';
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const r = await uploadFile(f);
      editor.value?.chain().focus().setImage({ src: `/files/${r.sha256}`, alt: f.name }).run();
    } catch {
      error.value = tx('uploadFailed');
    }
  }
}
const images = (list?: FileList | null) =>
  [...(list ?? [])].filter((f) => f.type.startsWith('image/'));

// '/' — block menu
const Slash = Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem & { key: string; label: string }, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashMenu'),
        char: '/',
        items: ({ query }) =>
          filterSlash(query).map((i) => ({
            ...i,
            key: i.id,
            label: i.title[i18n.global.locale.value === 'en' ? 'en' : 'ru'],
          })),
        command: ({ editor: ed, range, props: item }) => {
          ed.chain().focus().deleteRange(range).run();
          item.run(ed, { pickImage: () => fileInput.value?.click() });
        },
        render: render as never,
      }),
    ];
  },
});

// '@' — people, '#' — tasks; one mention node, tasks have attrs.kind = 'task'
const TaskMention = Mention.extend({
  addAttributes() {
    return { ...this.parent?.(), kind: { default: null } };
  },
}).configure({
  HTMLAttributes: { class: 'mention' },
  renderText: ({ node }) => `${node.attrs.kind === 'task' ? '#' : '@'}${node.attrs.label}`,
  renderHTML: ({ node, options }) =>
    node.attrs.kind === 'task'
      ? [
          'a',
          { ...options.HTMLAttributes, href: `/t/${node.attrs.label}`, 'data-kind': 'task' },
          `#${node.attrs.label}`,
        ]
      : ['span', options.HTMLAttributes, `@${node.attrs.label}`],
  suggestions: [
    {
      char: '@',
      pluginKey: new PluginKey('mentionUser'),
      items: ({ query }: { query: string }) =>
        props.members
          .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8)
          .map((m) => ({ id: m.id, label: m.name, key: m.id })),
      render: render as never,
    },
    {
      char: '#',
      pluginKey: new PluginKey('mentionTask'),
      items: ({ query }: { query: string }) =>
        tasks
          .search(query)
          .slice(0, 8)
          .map((h) => ({ id: h.id, label: h.ref, kind: 'task', key: h.id, title: h.title })),
      render: render as never,
    },
  ],
});

const editor = shallowRef<Editor | null>(null);
let session: { destroy: () => void; retry: () => void } | undefined;
const unsynced = ref(false);
const retry = () => {
  unsynced.value = false;
  session?.retry();
};
let gone = false;
let readOnly = () => false;

// yjs/hocuspocus — separate chunk
void import('@planar/editor/collab').then(({ openCollab }) => {
  if (gone) return;
  const c = openCollab(props.name, { id: user.value?.id ?? '', name: user.value?.name ?? '' });
  session = c;
  readOnly = c.readOnly;
  const ed = new Editor({
    editable: props.editable,
    extensions: [
      Placeholder.configure({ placeholder: tx('placeholder') }),
      ...editorExtensions({ collab: true, image: true, mention: TaskMention }),
      Slash,
      ...c.extensions,
    ],
    editorProps: {
      attributes: { 'aria-label': tx('body'), role: 'textbox', 'aria-multiline': 'true' },
      handleClick: (_v, _p, e) => {
        const a = (e.target as HTMLElement).closest?.('a[data-kind="task"]');
        if (!a) return false;
        e.preventDefault();
        emit('open-task', a.textContent!.slice(1));
        return true;
      },
      handlePaste: (_v, e) => {
        const f = images(e.clipboardData?.files);
        if (f.length) void insertImages(f);
        return f.length > 0;
      },
      handleDrop: (_v, e) => {
        const f = images(e.dataTransfer?.files);
        if (f.length) void insertImages(f);
        return f.length > 0;
      },
    },
  });
  editor.value = ed;
  c.onAuthenticated(() => ed.setEditable(props.editable && !readOnly()));
  c.onDenied(() => (unsynced.value = true));
  c.onAuthenticated(() => (unsynced.value = false));
});

watch(
  () => props.editable,
  (v) => editor.value?.setEditable(v && !readOnly()),
);
onBeforeUnmount(() => {
  gone = true;
  editor.value?.destroy();
  session?.destroy();
});
defineExpose({ editor });
</script>

<template>
  <div class="doc-editor relative">
    <EditorContent :editor="editor ?? undefined" />
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="
        (e) => {
          void insertImages([...((e.target as HTMLInputElement).files ?? [])]);
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
      {{ tx('unsynced') }}
      <button type="button" class="underline" @click="retry">{{ tx('retry') }}</button>
    </p>
    <ul
      v-if="sug && sug.items.length"
      role="listbox"
      :aria-label="tx('mention')"
      class="fixed z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-md"
      :style="sug.rect ? { left: sug.rect.left + 'px', top: sug.rect.bottom + 4 + 'px' } : {}"
    >
      <li
        v-for="(it, i) in sug.items"
        :key="it.key"
        role="option"
        :aria-selected="i === sug.index"
        :class="[
          'flex h-8 cursor-default items-center rounded-sm px-2 text-base text-fg',
          i === sug.index && 'bg-bg-muted',
        ]"
        @mousedown.prevent="sug.select(i)"
      >
        {{ it.label }}
      </li>
    </ul>
  </div>
</template>

<style>
.doc-editor .ProseMirror {
  outline: none;
  min-height: 12rem;
  overflow-wrap: anywhere;
}
.doc-editor .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: var(--color-fg-subtle);
}
.doc-editor .ProseMirror ul:not([data-type='taskList']) {
  list-style: disc;
  padding-left: 1.25rem;
}
.doc-editor .ProseMirror ol {
  list-style: decimal;
  padding-left: 1.25rem;
}
.doc-editor .ProseMirror ul[data-type='taskList'] {
  list-style: none;
  padding-left: 0;
}
.doc-editor .ProseMirror ul[data-type='taskList'] li {
  display: flex;
  gap: 0.5rem;
}
.doc-editor .ProseMirror ul[data-type='taskList'] li > div {
  flex: 1;
}
.doc-editor .ProseMirror h1,
.doc-editor .ProseMirror h2,
.doc-editor .ProseMirror h3 {
  font-weight: 600;
  margin: 0.75rem 0 0.25rem;
}
.doc-editor .ProseMirror h1 {
  font-size: var(--text-2xl);
}
.doc-editor .ProseMirror h2 {
  font-size: var(--text-xl);
}
.doc-editor .ProseMirror h3 {
  font-size: var(--text-lg);
}
.doc-editor .ProseMirror code {
  font-family: var(--font-mono);
  background: var(--color-bg-muted);
  border-radius: var(--radius-sm);
  padding: 0 0.25rem;
}
.doc-editor .ProseMirror pre {
  font-family: var(--font-mono);
  background: var(--color-bg-muted);
  border-radius: var(--radius-md);
  padding: 0.5rem;
  overflow-x: auto;
}
.doc-editor .ProseMirror table {
  border-collapse: collapse;
  width: 100%;
  table-layout: fixed;
}
.doc-editor .ProseMirror th,
.doc-editor .ProseMirror td {
  border: 1px solid var(--color-border-strong);
  padding: 0.25rem 0.5rem;
  vertical-align: top;
}
.doc-editor .ProseMirror th {
  background: var(--color-bg-muted);
  font-weight: 600;
  text-align: left;
}
.doc-editor .ProseMirror img {
  max-width: 100%;
  border-radius: var(--radius-md);
}
.doc-editor .mention {
  color: var(--color-accent);
  font-weight: 500;
}
.doc-editor .collaboration-carets__caret {
  position: relative;
  margin: 0 -1px;
  border-left: 1px solid;
  border-right: 1px solid;
  word-break: normal;
  pointer-events: none;
}
.doc-editor .collaboration-carets__label {
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
