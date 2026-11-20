import { h, type VNode } from 'vue';

interface N {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: N[];
}
const SAFE_URL = /^(https?:|mailto:)/i;
// own addresses: path from root, not //host and not /\host (the browser reads it as //host)
const INTERNAL = /^\/(?![/\\])/;
/** Block nodes → tag and classes: the CSS reset strips list markers, table borders (PLNRAPP-334). */
const TAGS: Record<string, [string, string?]> = {
  paragraph: ['p'],
  bulletList: ['ul', 'list-disc pl-5'],
  orderedList: ['ol', 'list-decimal pl-5'],
  listItem: ['li'],
  taskList: ['ul', 'list-none'],
  blockquote: ['blockquote', 'border-l-2 border-border-strong pl-3 text-fg-muted'],
  heading: ['p', 'font-semibold'],
  tableRow: ['tr'],
  tableHeader: ['th', 'border border-border-strong bg-bg-muted px-2 py-1 text-left font-semibold'],
  tableCell: ['td', 'border border-border-strong px-2 py-1 align-top'],
};
const MARK: Record<string, string> = { bold: 'strong', italic: 'em', strike: 's', code: 'code' };
const MARK_CLASS: Record<string, string> = {
  code: 'rounded-sm bg-bg-muted px-1 font-mono text-[0.9em]',
};

function node(n: N, me: string, i: number): VNode | string {
  const kids = () => (n.content ?? []).map((c, j) => node(c, me, j));
  switch (n.type) {
    case 'text': {
      let v: VNode | string = n.text ?? '';
      for (const m of n.marks ?? []) {
        const href = String(m.attrs?.href ?? '');
        if (m.type === 'link' && INTERNAL.test(href))
          v = h('a', { href, 'data-internal': '', class: 'text-accent underline' }, [v]);
        else if (m.type === 'link' && SAFE_URL.test(href))
          v = h(
            'a',
            { href, target: '_blank', rel: 'noopener noreferrer', class: 'text-accent underline' },
            [v],
          );
        else if (MARK[m.type]) v = h(MARK[m.type]!, { class: MARK_CLASS[m.type] }, [v]);
      }
      return v;
    }
    case 'mention':
      return h(
        'span',
        { key: i, class: ['mention', n.attrs?.id === me && 'font-medium text-accent'] },
        `@${String(n.attrs?.label ?? n.attrs?.id ?? '')}`,
      );
    case 'hardBreak':
      return h('br');
    case 'codeBlock':
      return h('pre', { key: i, class: 'overflow-x-auto rounded-md bg-bg-muted p-2 text-sm' }, [
        h('code', { class: 'font-mono' }, kids()),
      ]);
    case 'horizontalRule':
      return h('hr', { key: i, class: 'border-border' });
    case 'taskItem':
      return h('li', { key: i, class: 'flex items-start gap-2' }, [
        h('input', {
          type: 'checkbox',
          checked: !!n.attrs?.checked,
          disabled: true,
          tabindex: -1,
          class: 'mt-1',
        }),
        h('div', { class: 'min-w-0 flex-1' }, kids()),
      ]);
    case 'table':
      return h('div', { key: i, class: 'overflow-x-auto' }, [
        h('table', { class: 'border-collapse text-sm' }, [h('tbody', kids())]),
      ]);
    default: {
      const [tag, cls] = TAGS[n.type ?? ''] ?? ['div'];
      return h(tag, { key: i, class: cls }, kids());
    }
  }
}

/** TipTap JSON → VNode without v-html. */
export default function RichBody(props: { body: unknown; me: string }) {
  const doc = props.body as N;
  return h(
    'div',
    // blocks one under another with a small gap (also inside list items), not glued together
    { class: 'chat-body break-words space-y-1.5 [&_li>*+*]:mt-1' },
    (doc.content ?? []).map((c, i) => node(c, props.me, i)),
  );
}
RichBody.props = ['body', 'me'];
