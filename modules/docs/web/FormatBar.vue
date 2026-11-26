<script setup lang="ts">
import { onBeforeUnmount, ref, watch, type Component } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
  Underline,
} from '@lucide/vue';
import { IconButton, Toolbar } from '@planar/web/modules';
import { useTexts, type TextKey } from './text';

// PLNRAPP-231: the page text formatting menu — marks, headings, lists, blocks (StarterKit + TaskList)
const props = defineProps<{ editor: Editor }>();
const tx = useTexts();

type Item = {
  id: string;
  label: TextKey;
  icon: Component;
  active: (e: Editor) => boolean;
  run: (e: Editor) => void;
};
const items: Item[] = [
  { id: 'bold', label: 'fmtBold', icon: Bold, active: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { id: 'italic', label: 'fmtItalic', icon: Italic, active: (e) => e.isActive('italic'), run: (e) => e.chain().focus().toggleItalic().run() },
  { id: 'underline', label: 'fmtUnderline', icon: Underline, active: (e) => e.isActive('underline'), run: (e) => e.chain().focus().toggleUnderline().run() },
  { id: 'strike', label: 'fmtStrike', icon: Strikethrough, active: (e) => e.isActive('strike'), run: (e) => e.chain().focus().toggleStrike().run() },
  { id: 'code', label: 'fmtCode', icon: Code, active: (e) => e.isActive('code'), run: (e) => e.chain().focus().toggleCode().run() },
  ...([1, 2, 3] as const).map((level) => ({
    id: `h${level}`,
    label: `fmtH${level}` as TextKey,
    icon: [Heading1, Heading2, Heading3][level - 1]!,
    active: (e: Editor) => e.isActive('heading', { level }),
    run: (e: Editor) => e.chain().focus().toggleHeading({ level }).run(),
  })),
  { id: 'bullet', label: 'fmtBullet', icon: List, active: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'ordered', label: 'fmtOrdered', icon: ListOrdered, active: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'todo', label: 'fmtTodo', icon: ListChecks, active: (e) => e.isActive('taskList'), run: (e) => e.chain().focus().toggleTaskList().run() },
  { id: 'quote', label: 'fmtQuote', icon: Quote, active: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { id: 'codeBlock', label: 'fmtCodeBlock', icon: SquareCode, active: (e) => e.isActive('codeBlock'), run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

// the editor state is not reactive: the active marks are re-read on every transaction
const active = ref<Record<string, boolean>>({});
const read = () => {
  active.value = Object.fromEntries(items.map((i) => [i.id, i.active(props.editor)]));
};
watch(
  () => props.editor,
  (e, old) => {
    old?.off('transaction', read);
    e.on('transaction', read);
    read();
  },
  { immediate: true },
);
onBeforeUnmount(() => props.editor.off('transaction', read));
</script>

<template>
  <!-- sticky over the text; mousedown.prevent keeps the selection in the editor -->
  <Toolbar
    :label="tx('format')"
    class="sticky top-0 z-10 -mx-2 mb-2 bg-bg"
    data-testid="doc-format"
  >
    <IconButton
      v-for="i in items"
      :key="i.id"
      size="sm"
      :icon="i.icon"
      :label="tx(i.label)"
      :active="!!active[i.id]"
      :data-format="i.id"
      @mousedown.prevent
      @click="i.run(editor)"
    />
  </Toolbar>
</template>
