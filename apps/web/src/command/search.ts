import { computed, watch } from 'vue';
import type { Row } from '@planar/shared';
import { db, useQuery } from '../sync';

export interface Hit {
  id: string;
  /** PLN-12; until a number is assigned — id */
  ref: string;
  title: string;
}
interface Entry extends Hit {
  updatedAt: string;
  key: string;
  t: string;
  /** name + key + description */
  all: string;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const words = (q: string) => norm(q).split(/\s+/).filter(Boolean);

/** Text of all text nodes of TipTap JSON; a mention is "@Name". */
export function docText(n: unknown): string {
  if (!n || typeof n !== 'object') return typeof n === 'string' ? n : '';
  const o = n as {
    type?: string;
    text?: unknown;
    attrs?: { label?: unknown };
    content?: unknown[];
  };
  if (o.type === 'mention' && typeof o.attrs?.label === 'string') return `@${o.attrs.label} `;
  return (typeof o.text === 'string' ? o.text + ' ' : '') + (o.content ?? []).map(docText).join('');
}

const LIMIT = 50;

export function createIndex() {
  const entries = new Map<string, Entry>();
  return {
    /** Updates only changed (id + updatedAt) tasks, removes vanished ones. */
    update(tasks: Row<'tasks'>[], projectKey: Map<string, string>) {
      const seen = new Set<string>();
      for (const t of tasks) {
        seen.add(t.id);
        if (entries.get(t.id)?.updatedAt === t.updatedAt) continue;
        const pk = projectKey.get(t.projectId);
        const ref = pk && t.number != null ? `${pk}-${t.number}` : t.id;
        const title = norm(t.title);
        const key = pk && t.number != null ? norm(ref) : '';
        entries.set(t.id, {
          id: t.id,
          ref,
          title: t.title,
          updatedAt: t.updatedAt,
          key,
          t: title,
          all: `${title}\n${key}\n${norm(docText(t.description))}`,
        });
      }
      for (const id of entries.keys()) if (!seen.has(id)) entries.delete(id);
    },
    /** All words are substrings; exact key > name start > name > description. */
    search(q: string): Hit[] {
      const ws = words(q);
      if (!ws.length) return [];
      const nq = ws.join(' ');
      const b: Entry[][] = [[], [], [], []];
      for (const e of entries.values()) {
        if (!ws.every((w) => e.all.includes(w))) continue;
        b[
          e.key === nq ? 0 : e.t.startsWith(nq) ? 1 : ws.every((w) => e.t.includes(w)) ? 2 : 3
        ].push(e);
      }
      return b
        .flat()
        .slice(0, LIMIT)
        .map(({ id, ref, title }) => ({ id, ref, title }));
    },
  };
}

/** Index over the whole replica: subscription to db.tasks, search is synchronous. */
export function useSearch() {
  const index = createIndex();
  const data = useQuery(async () => {
    const [tasks, projects] = await Promise.all([
      db.table<Row<'tasks'>>('tasks').toArray(),
      db.table<Row<'projects'>>('projects').toArray(),
    ]);
    return { tasks, keys: new Map(projects.map((p) => [p.id, p.key])) };
  });
  const ready = computed(() => data.value !== undefined);
  watch(data, (d) => d && index.update(d.tasks, d.keys), { immediate: true, flush: 'sync' });
  // reading data.value makes results reactive: the palette recalculates when the replica changes
  return { ready, search: (q: string) => (void data.value, index.search(q)) };
}
