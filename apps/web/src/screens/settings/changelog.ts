/// <reference types="vite/client" />
// CHANGELOG.md at the repo root is in the build context (deploy/caddy.Dockerfile: COPY . .)
import raw from '../../../../../CHANGELOG.md?raw';

export interface Release {
  version: string;
  date: string;
  sections: { title: string; items: string[] }[];
}

/** Released versions of a Keep a Changelog file, newest first; [Unreleased] is skipped. */
export function parseChangelog(md: string): Release[] {
  const out: Release[] = [];
  let cur: Release | undefined;
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) {
      const v = line.match(/^## \[(\d[^\]]*)\](?: - (\S+))?/);
      cur = v ? { version: v[1]!, date: v[2] ?? '', sections: [] } : undefined;
      if (cur) out.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith('### ')) cur.sections.push({ title: line.slice(4), items: [] });
    else if (line.startsWith('- ')) cur.sections.at(-1)?.items.push(line.slice(2).replace(/`/g, ''));
  }
  return out;
}

export const releases = parseChangelog(raw);
