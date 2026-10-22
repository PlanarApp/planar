type Node = { type?: string; attrs?: { id?: string }; content?: unknown[] };

/** id упомянутых пользователей (узлы mention), без повторов, в порядке появления. */
export function extractMentions(doc: unknown): string[] {
  const ids = new Set<string>();
  const walk = (n: unknown) => {
    const node = n as Node;
    if (node?.type === 'mention' && typeof node.attrs?.id === 'string') ids.add(node.attrs.id);
    node?.content?.forEach(walk);
  };
  walk(doc);
  return [...ids];
}

/** Абзацы по переводам строки; `@login` известного пользователя → узел mention. */
export function textToDoc(text: string, users: { id: string; login: string }[]) {
  const byLogin = new Map(users.map((u) => [u.login, u.id]));
  const paragraph = (line: string) => {
    const content: unknown[] = [];
    line.split(/(@[\w.-]+)/).forEach((part, i) => {
      if (!part) return;
      const id = i % 2 ? byLogin.get(part.slice(1)) : undefined;
      content.push(
        id
          ? { type: 'mention', attrs: { id, label: part.slice(1) } }
          : { type: 'text', text: part },
      );
    });
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
  };
  return { type: 'doc' as const, content: text.split('\n').map(paragraph) };
}
