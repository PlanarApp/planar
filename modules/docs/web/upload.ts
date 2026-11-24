import type { Editor } from '@tiptap/vue-3';
import type { Uploaded } from '@planar/web/modules';

/** Link to an uploaded file: `?name=` — download under the original name (GET /files/:sha256). */
export const fileHref = (sha: string, name: string) =>
  `/files/${sha}?name=${encodeURIComponent(name)}`;

/**
 * PLNRAPP-832: files from the clipboard or a drop go into the page text — an image as a picture,
 * any other file as a link with its name. `pos` — drop point; without it — at the cursor.
 * Errors are collected per file: one failed upload does not stop the rest.
 */
export async function insertUploads(
  editor: Editor,
  files: File[],
  upload: (f: File) => Promise<Uploaded>,
  pos?: number,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  let at = pos;
  for (const f of files) {
    let r: Uploaded;
    try {
      r = await upload(f);
    } catch (e) {
      errors.push(e);
      continue;
    }
    if (editor.isDestroyed) break;
    const content = f.type.startsWith('image/')
      ? [{ type: 'image', attrs: { src: `/files/${r.sha256}`, alt: f.name } }]
      : [
          { type: 'text', text: f.name, marks: [{ type: 'link', attrs: { href: fileHref(r.sha256, f.name) } }] },
          { type: 'text', text: ' ' },
        ];
    const c = editor.chain().focus();
    (at === undefined ? c.insertContent(content) : c.insertContentAt(at, content)).run();
    // the next file goes after the inserted one
    if (at !== undefined) at = editor.state.selection.to;
  }
  return errors;
}
