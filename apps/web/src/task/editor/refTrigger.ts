import { Extension, InputRule, type Editor } from '@tiptap/core';

export interface RefAt {
  pos: number;
  rect: { left: number; top: number; bottom: number };
}

/**
 * @@ (PLNRAPP-833: the task editor and the document editor): the characters are removed, `open` gets the
 * position and the cursor rect — the caller shows RefPicker there and inserts the chosen link at `pos`
 */
export const refTrigger = (open: (at: RefAt) => void) =>
  Extension.create({
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
            open({ pos: from, rect: { left: c.left, top: c.top, bottom: c.bottom } });
          },
        }),
      ];
    },
  });

/** the chosen task/document link at the @@ position, followed by a space */
export const insertRefAt = (
  ed: Editor | null | undefined,
  pos: number,
  r: { label: string; href: string },
) =>
  ed
    ?.chain()
    .focus()
    .insertContentAt(pos, [
      { type: 'text', text: r.label, marks: [{ type: 'link', attrs: { href: r.href } }] },
      { type: 'text', text: ' ' },
    ])
    .run();
