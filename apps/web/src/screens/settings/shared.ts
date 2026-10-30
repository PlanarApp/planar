import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Row } from '@planar/shared';
import { useAuth } from '../../auth/useAuth';
import { db, useQuery } from '../../sync';

/** Running an edit: a mutator error (conflict, etc.) → text to show, without an exception. */
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

/** Spaces where the current user is admin. */
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

/** Node icon — one character (an emoji made of several code points also counts as one). */
export function firstGrapheme(v: string): string {
  const [g] = new Intl.Segmenter().segment(v);
  return g?.segment ?? '';
}
