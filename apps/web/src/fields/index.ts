import { getCurrentScope, onScopeDispose, readonly, shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter, Ref } from 'vue';
import { liveQuery, type Subscription } from 'dexie';
import type { Row } from '@planar/shared';
import { db, mutate } from '../sync';

export { default as FieldCell } from './FieldCell.vue';
export { default as FieldEditor } from './FieldEditor.vue';

/** liveQuery with a reactive argument (see tasks/queries useLive). */
function live<A, T>(arg: () => A, fn: (a: A) => Promise<T>): Readonly<Ref<T | undefined>> {
  const r = shallowRef<T>();
  let sub: Subscription | undefined;
  watch(
    arg,
    (a) => {
      sub?.unsubscribe();
      r.value = undefined;
      sub = liveQuery(() => fn(a)).subscribe({ next: (v) => (r.value = v), error: () => {} });
    },
    { immediate: true, flush: 'sync' },
  );
  if (getCurrentScope()) onScopeDispose(() => sub?.unsubscribe());
  return readonly(r) as Readonly<Ref<T | undefined>>;
}

const byRank = (a: { rank: string }, b: { rank: string }) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
const defs = () => db.table<Row<'fieldDefs'>>('fieldDefs');

export const useFieldDefs = (projectId: MaybeRefOrGetter<string>) =>
  live(
    () => toValue(projectId),
    async (p) => (await defs().where('projectId').equals(p).toArray()).sort(byRank),
  );

/** Definitions of all projects in the space (filter builder without project). */
export const useSpaceFieldDefs = (spaceId: MaybeRefOrGetter<string>) =>
  live(
    () => toValue(spaceId),
    async (s) => (await defs().where('spaceId').equals(s).toArray()).sort(byRank),
  );

/** Definitions by id (filters); deleted ones are skipped. */
export const useFieldDefsByIds = (ids: MaybeRefOrGetter<string>) =>
  live(
    () => toValue(ids),
    async (s) =>
      (await defs().bulkGet(s ? s.split(',') : [])).filter(Boolean) as Row<'fieldDefs'>[],
  );

export const setTaskField = (taskId: string, fieldId: string, value: unknown): Promise<void> =>
  mutate('task.setField', { taskId, fieldId, value: value as never }) as Promise<void>;

export function formatFieldValue(
  def: Row<'fieldDefs'>,
  value: unknown,
  ctx: { locale: string; users: Row<'users'>[] },
): string {
  if (value === undefined || value === null) return '';
  switch (def.type) {
    case 'select': {
      const c = (def.options.choices as { id: string; label: string }[] | undefined) ?? [];
      return c.find((x) => x.id === value)?.label ?? '';
    }
    case 'user':
      return ctx.users.find((u) => u.id === value)?.name ?? '';
    case 'money':
      return typeof value === 'number'
        ? new Intl.NumberFormat(ctx.locale, {
            style: 'currency',
            currency: String(def.options.currency ?? 'RUB'),
          }).format(value / 100)
        : '';
    default:
      return String(value);
  }
}
