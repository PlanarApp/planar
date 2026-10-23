import { FileText } from 'lucide-vue-next';
import { db } from '@planar/web/sync';
import { searchPages, type PageRow } from './model';
import { label } from './text';

export const pageSearch = {
  id: 'pages',
  label: label('docs'),
  async search(q: string, limit: number) {
    const pages = await db.table<PageRow>('docsPages').toArray();
    return searchPages(pages, q, limit).map((p) => ({
      id: p.id,
      title: p.title || label('untitled').ru,
      subtitle: p.text.slice(0, 80) || undefined,
      icon: FileText,
      to: `/m/docs/${p.id}`,
    }));
  },
};
