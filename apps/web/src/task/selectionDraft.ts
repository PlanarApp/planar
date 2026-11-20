import type { JSONContent } from '@tiptap/core';

/** Предел имени задачи из выделения (PLNRAPP-684), вместе с «…». */
export const TITLE_MAX = 120;

/**
 * Выделенный текст → черновик диалога создания задачи (PLNRAPP-684): имя — первая непустая строка
 * (plain text, ≤ TITLE_MAX, обрезка по границе слова с «…»); description — полный текст выделения,
 * если имя обрезано или выделение многострочное, иначе null.
 */
export function selectionDraft(text: string): { title: string; description: string | null } {
  const lines = text.split(/\r?\n/);
  const filled = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const first = filled[0] ?? '';
  let title = first;
  const cut = first.length > TITLE_MAX;
  if (cut) {
    const limit = TITLE_MAX - 1; // место под «…»
    const head = first.slice(0, limit + 1);
    const sp = head.lastIndexOf(' ');
    title = `${(sp > 0 ? head.slice(0, sp) : head.slice(0, limit)).trimEnd()}…`;
  }
  const full = lines
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
  return { title, description: cut || filled.length > 1 ? full : null };
}

/** Plain text → документ редактора: строка — абзац, пустая строка — пустой абзац. */
export function plainDoc(text: string): JSONContent {
  return {
    type: 'doc',
    content: text
      .split('\n')
      .map((l) =>
        l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' },
      ),
  };
}
