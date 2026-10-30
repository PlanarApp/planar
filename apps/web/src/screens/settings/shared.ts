import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { useAuth } from '../../auth/useAuth';
import { db, useQuery } from '../../sync';

/** Выполнение правки: ошибка мутатора (conflict и т.п.) → текст для показа, без исключения. */
export function useAction() {
  const { t } = useI18n();
  const error = ref('');
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    error.value = '';
    try {
      await fn();
      return true;
    } catch (e) {
      const m = e as { code?: string; message?: string };
      error.value = m.code === 'conflict' && m.message ? m.message : t('auth.failed');
      return false;
    }
  }
  return { error, run };
}

/** Пространства, где текущий пользователь — admin. */
export function useAdminSpaces() {
  const { user } = useAuth();
  const rows = useQuery(() =>
    db
      .table<Row<'spaceMembers'>>('spaceMembers')
      .filter((m) => m.role === 'admin' && m.userId === user.value?.id)
      .toArray(),
  );
  return (spaceId: string) => !!rows.value?.some((m) => m.spaceId === spaceId);
}

export const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** Иконка узла — один символ (эмодзи из нескольких кодовых точек — тоже один). */
export function firstGrapheme(v: string): string {
  const [g] = new Intl.Segmenter().segment(v);
  return g?.segment ?? '';
}
