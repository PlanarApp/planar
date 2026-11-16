import { computed, getCurrentScope, onScopeDispose, shallowRef } from 'vue';
import type { Row } from '@planar/shared';
import { db, onReplicaChange, type ReplicaChange } from '../sync';

export interface Hit {
  id: string;
  /** PLN-12; until a number is assigned — id */
  ref: string;
  title: string;
  /** parent tasks, outermost first, " / "-joined; empty for a root task */
  path?: string;
}
interface Entry extends Hit {
  updatedAt: string;
  parentId: string | null;
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
  const put = (t: Row<'tasks'>, projectKey: Map<string, string>) => {
    const pk = projectKey.get(t.projectId);
    const ref = pk && t.number != null ? `${pk}-${t.number}` : t.id;
    const title = norm(t.title);
    const key = pk && t.number != null ? norm(ref) : '';
    entries.set(t.id, {
      id: t.id,
      ref,
      title: t.title,
      updatedAt: t.updatedAt,
      parentId: t.parentId ?? null,
      key,
      t: title,
      all: `${title}\n${key}\n${norm(docText(t.description))}`,
    });
  };
  // parent chain from the index itself (an archived parent is not there — the chain stops)
  const pathOf = (parentId: string | null) => {
    const names: string[] = [];
    for (let p = parentId ? entries.get(parentId) : undefined; p && names.length < 20;) {
      names.unshift(`${p.ref} ${p.title}`);
      p = p.parentId ? entries.get(p.parentId) : undefined;
    }
    return names.join(' / ');
  };
  return {
    /** Updates only changed (id + updatedAt) tasks, removes vanished ones. */
    update(tasks: Row<'tasks'>[], projectKey: Map<string, string>) {
      const seen = new Set<string>();
      for (const t of tasks) {
        seen.add(t.id);
        if (entries.get(t.id)?.updatedAt !== t.updatedAt) put(t, projectKey);
      }
      for (const id of entries.keys()) if (!seen.has(id)) entries.delete(id);
    },
    /** One task changed: null (deleted, archived) — out of the index. */
    set(id: string, t: Row<'tasks'> | null, projectKey: Map<string, string>) {
      if (t) put(t, projectKey);
      else entries.delete(id);
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
        .map(({ id, ref, title, parentId }) => ({ id, ref, title, path: pathOf(parentId) }));
    },
  };
}

/**
 * Index over the whole replica, search is synchronous. The tasks are read once, then patched by
 * onReplicaChange: a subscription to the table would re-read it on every edit of any task.
 */
export function useSearch() {
  const index = createIndex();
  let keys = new Map<string, string>();
  // bumped on every index change: reading it makes results reactive
  const version = shallowRef(0);
  // events during a read wait for it (the read may not see them yet); null — not reading
  let queue: ReplicaChange[] | null = null;
  const apply = (batch: ReplicaChange[]) => {
    let hit = false;
    for (const c of batch)
      if (c.entity === 'tasks') {
        const t = c.row as Row<'tasks'> | null;
        index.set(c.id, t && !t.archivedAt ? t : null, keys);
        hit = true;
      }
    if (hit) version.value++;
  };
  let gen = 0;
  const load = async () => {
    const g = ++gen;
    queue ??= [];
    const [tasks, projects] = await Promise.all([
      db.table<Row<'tasks'>>('tasks').toArray(),
      db.table<Row<'projects'>>('projects').toArray(),
    ]);
    if (g !== gen) return; // a newer read (reset, projects) has started
    keys = new Map(projects.map((p) => [p.id, p.key]));
    index.update(
      tasks.filter((t) => !t.archivedAt),
      keys,
    );
    const q = queue;
    queue = null;
    apply(q);
    version.value++;
  };
  const off = onReplicaChange((batch) => {
    // a project key is part of the refs; a reset — the replica anew
    if (batch.some((c) => c.entity === '*' || c.entity === 'projects')) return void load();
    if (queue) queue.push(...batch);
    else apply(batch);
  });
  if (getCurrentScope()) onScopeDispose(off);
  void load();
  const ready = computed(() => version.value > 0);
  return { ready, search: (q: string) => (void version.value, index.search(q)) };
}
