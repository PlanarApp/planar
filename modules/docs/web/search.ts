import { FileText } from '@lucide/vue';
import { db } from '@planar/web/modules';
import { pagePath, searchPages, type PageRow } from './model';
import { label } from './text';

export const pageSearch = {
  id: 'pages',
  label: label('docs'),
  async search(q: string, limit: number) {
    const [pages, projects] = await Promise.all([
      db.table<PageRow>('docsPages').toArray(),
      db.table<{ id: string; name: string }>('projects').toArray(),
    ]);
    const byId = new Map(pages.map((p) => [p.id, p]));
    const names = new Map(projects.map((x) => [x.id, x.name]));
    return searchPages(pages, q, limit).map((p) => ({
      id: p.id,
      title: p.title || label('untitled').ru,
      subtitle: p.text.slice(0, 80) || undefined,
      path: pagePath(byId, p, names, label('untitled').ru) || undefined,
      icon: FileText,
      to: `/m/docs/${p.id}`,
    }));
  },
};
