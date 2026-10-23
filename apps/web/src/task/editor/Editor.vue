<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import type { JSONContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import Image from '@tiptap/extension-image';
import { ApiError } from '../../api/http';
import { uploadFile } from '../files';

type Item = { id: string; label: string };
const props = withDefaults(
  defineProps<{
    modelValue?: JSONContent | null;
    members: { id: string; name: string }[];
    label: string;
    placeholder?: string;
    image?: boolean;
    editable?: boolean;
  }>(),
  { editable: true },
);
const emit = defineEmits<{
  'update:modelValue': [v: JSONContent | null];
  blur: [];
  submit: [];
}>();
const { t } = useI18n();
const error = ref('');

// подсказка @: состояние пишет suggestion, список рисуем сами
const sug = ref<{
  items: Item[];
  index: number;
  command: (i: Item) => void;
  rect: DOMRect | null;
} | null>(null);

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

const editor = useEditor({
  content: props.modelValue ?? '',
  editable: props.editable,
  extensions: [
    StarterKit,
    Placeholder.configure({ placeholder: props.placeholder ?? '' }),
    Mention.configure({
      HTMLAttributes: { class: 'mention' },
      suggestion: {
        char: '@',
        items: ({ query }: { query: string }): Item[] =>
          props.members
            .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map((m) => ({ id: m.id, label: m.name })),
        render: () => {
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
              else if (event.key === 'ArrowUp')
                s.index = (s.index + s.items.length - 1) % s.items.length;
              else if (event.key === 'Enter') s.command(s.items[s.index]);
              else return false;
              return true;
            },
          };
        },
      },
    }),
    ...(props.image ? [Image] : []),
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
      const files = imagesOf(e.dataTransfer?.files);
      if (files.length) void insertFiles(files);
      return files.length > 0;
    },
  },
  onUpdate: ({ editor: ed }) => emit('update:modelValue', ed.isEmpty ? null : ed.getJSON()),
  onBlur: () => emit('blur'),
});

// внешнее значение — только когда не печатаем (иначе сбросит набранное)
watch(
  () => props.modelValue,
  (v) => {
    const ed = editor.value;
    if (!ed || ed.isFocused) return;
    if (JSON.stringify(v ?? null) !== JSON.stringify(ed.isEmpty ? null : ed.getJSON()))
      ed.commands.setContent(v ?? '', { emitUpdate: false });
  },
);
watch(
  () => props.editable,
  (v) => editor.value?.setEditable(v),
);
onBeforeUnmount(() => editor.value?.destroy());

defineExpose({
  editor,
  insertFiles,
  clear: () => editor.value?.commands.clearContent(true),
  focus: () => editor.value?.commands.focus('end'),
});
</script>

<template>
  <div class="task-editor relative">
    <EditorContent :editor="editor" />
    <p v-if="error" role="alert" class="mt-1 text-xs text-danger">{{ error }}</p>
    <ul
      v-if="sug && sug.items.length"
      role="listbox"
      :aria-label="t('task.mention')"
      class="fixed z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-md"
      :style="sug.rect ? { left: sug.rect.left + 'px', top: sug.rect.bottom + 4 + 'px' } : {}"
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
.task-editor .ProseMirror ul {
  list-style: disc;
  padding-left: 1.25rem;
}
.task-editor .ProseMirror ol {
  list-style: decimal;
  padding-left: 1.25rem;
}
.task-editor .ProseMirror h1,
.task-editor .ProseMirror h2,
.task-editor .ProseMirror h3 {
  font-weight: 600;
  font-size: var(--text-lg);
  margin: 0.5rem 0 0.25rem;
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
.task-editor .mention {
  color: var(--color-accent);
  font-weight: 500;
}
</style>
