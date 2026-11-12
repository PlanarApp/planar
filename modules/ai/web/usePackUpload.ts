import { reactive, ref } from 'vue';
import { call } from './api';

// Upload of a pack with conflict resolution (reset / keep / merge per page); shared by PacksSection and SetupWizard.
export type Conflict = { key: string; pageId: string; title: string };
export type Choice = 'reset' | 'keep' | 'merge';
export type Src = { packKey: string; zip?: string; title?: string };

/** `guard` runs a step with busy/error handling (the caller's), `onLoaded` refreshes the caller's list. */
export function usePackUpload(
  projectId: string,
  guard: (fn: () => Promise<void>) => Promise<void>,
  onLoaded: () => Promise<void>,
) {
  // the upload being resolved: its source and the conflicting pages
  const pending = ref<(Src & { conflicts: Conflict[] }) | null>(null);
  const choice = reactive<Record<string, Choice>>({});
  const merged = reactive<Record<string, string>>({});

  /** Resolves to the API status; undefined when the step failed (the error is in `guard`). */
  async function upload(src: Src, resolve?: Record<string, unknown>) {
    let status: 'ok' | 'conflict' | undefined;
    await guard(async () => {
      const r = await call<{ status: 'ok' | 'conflict'; conflicts?: Conflict[] }>(
        'POST',
        'packs/upload',
        { projectId, ...src, resolve },
      );
      status = r.status;
      if (r.status === 'conflict') {
        pending.value = { ...src, conflicts: r.conflicts ?? [] };
        for (const c of r.conflicts ?? []) choice[c.key] ??= 'keep';
      } else pending.value = null;
      await onLoaded();
    });
    return status;
  }
  const merge = (c: Conflict) =>
    guard(async () => {
      const p = pending.value!;
      const r = await call<{ merged: string }>('POST', 'packs/merge', {
        projectId,
        packKey: p.packKey,
        zip: p.zip,
        title: p.title,
        key: c.key,
      });
      merged[c.key] = r.merged;
      choice[c.key] = 'merge';
    });
  const resolveAll = () => {
    const p = pending.value!;
    const resolve = Object.fromEntries(
      p.conflicts.map((c) => [
        c.key,
        choice[c.key] === 'merge' ? { merged: merged[c.key] } : choice[c.key],
      ]),
    );
    return upload(p, resolve);
  };
  const canResolve = () =>
    pending.value?.conflicts.every((c) => choice[c.key] !== 'merge' || merged[c.key]);
  return { pending, choice, merged, upload, merge, resolveAll, canResolve };
}
export type PackUpload = ReturnType<typeof usePackUpload>;
