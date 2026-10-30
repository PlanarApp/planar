import { h, type VNode } from 'vue';

interface N {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: N[];
}
const SAFE_URL = /^(https?:|mailto:)/i;
// свои адреса: путь от корня, не //host и не /\host (браузер читает его как //host)
const INTERNAL = /^\/(?![/\\])/;
const TAGS: Record<string, string> = {
  paragraph: 'p',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  blockquote: 'blockquote',
  heading: 'p',
};
const MARK: Record<string, string> = { bold: 'strong', italic: 'em', strike: 's', code: 'code' };

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
        else if (MARK[m.type]) v = h(MARK[m.type]!, [v]);
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
      return h('pre', { class: 'overflow-x-auto rounded-md bg-bg-muted p-2 text-sm' }, [
        h('code', kids()),
      ]);
    default:
      return h(TAGS[n.type ?? ''] ?? 'div', { key: i }, kids());
  }
}

/** TipTap JSON → VNode без v-html. */
export default function RichBody(props: { body: unknown; me: string }) {
  const doc = props.body as N;
  return h(
    'div',
    { class: 'chat-body break-words' },
    (doc.content ?? []).map((c, i) => node(c, props.me, i)),
  );
}
RichBody.props = ['body', 'me'];
