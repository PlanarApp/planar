import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { HttpError } from '../auth/errors.js';

/** docs-site: the repo root from src/ or dist/ (apps/api/{src,dist}/mcp), /app/docs-site in the image. */
const ROOTS = ['../../../../docs-site', '../../docs-site'].map((p) =>
  fileURLToPath(new URL(p, import.meta.url)),
);
const root = () => ROOTS.find((p) => existsSync(p));

export const docsSiteShape = {
  query: z.string().min(1).describe('слова поиска; без section — список совпадений'),
  lang: z.enum(['ru', 'en']).optional().describe('язык документации, по умолчанию ru'),
  section: z
    .string()
    .optional()
    .describe('id раздела из результата поиска (файл#заголовок) — вернуть его текст'),
};

interface Sec {
  id: string;
  title: string;
  file: string;
  text: string;
}

/** Files of a language split into sections by h1–h3 (outside code fences); read on every call. */
function sections(lang: string): Sec[] {
  const base = root();
  if (!base) throw new HttpError(404, 'not_found', 'docs-site недоступен');
  const dir = `${base}/${lang}`;
  const res: Sec[] = [];
  for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : []) {
    const src = readFileSync(`${dir}/${file}`, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
    let cur: Sec = { id: file, title: file, file, text: '' };
    let fence = false;
    const flush = () => cur.text.trim() && res.push({ ...cur, text: cur.text.trim() });
    for (const line of src.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      const h = !fence && /^#{1,3}\s+(.+?)\s*#*$/.exec(line);
      if (h) {
        flush();
        cur = { id: `${file}#${h[1]}`, title: h[1]!, file, text: '' };
      }
      cur.text += `${line}\n`;
    }
    flush();
  }
  return res;
}

export function searchDocsSite(a: { query: string; lang?: 'ru' | 'en'; section?: string }) {
  const all = sections(a.lang ?? 'ru');
  if (a.section !== undefined) {
    const s = all.find((x) => x.id.toLowerCase() === a.section!.toLowerCase());
    if (!s) throw new HttpError(404, 'not_found', `Раздел не найден: ${a.section}`);
    return { id: s.id, title: s.title, file: s.file, text: s.text };
  }
  const words = a.query.toLowerCase().split(/\s+/).filter(Boolean);
  return all
    .map((s) => {
      const t = s.text.toLowerCase();
      if (!words.every((w) => t.includes(w))) return null;
      const score = words.filter((w) => s.title.toLowerCase().includes(w)).length;
      return { s, score, at: Math.max(0, t.indexOf(words[0]!) - 60) };
    })
    .filter((x) => x !== null)
    .sort((x, y) => y.score - x.score)
    .slice(0, 10)
    .map(({ s, at }) => ({
      section: s.id,
      title: s.title,
      file: s.file,
      fragment: s.text.slice(at, at + 300),
    }));
}
