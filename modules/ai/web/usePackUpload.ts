import { reactive, ref } from 'vue';
import { call } from './api';
import { defaultChoice, type PageChoice } from './harnessUi';

// PLNRAPP-538: upload of a pack in steps — the pages that differ from the pack (preview) → a choice per page
// (mine / pack / merge) → the final texts (one merge request for all «merge» pages) → save; shared by
// PacksSection and SetupWizard.
export type PreviewPage = {
  key: string;
  title: string;
  kind: 'new' | 'changed';
  edited: boolean;
  current: string | null;
  incoming: string;
};
export type Src = { packKey: string; zip?: string; title?: string };
type Uploaded = { status: 'ok' | 'conflict'; rootPageId?: string };

/** `guard` runs a step with busy/error handling (the caller's), `onLoaded` refreshes the caller's list. */
export function usePackUpload(
  projectId: string,
  guard: (fn: () => Promise<void>) => Promise<void>,
  onLoaded: () => Promise<void>,
) {
  // the upload being reviewed: its source and the pages that differ from the pack
  const pending = ref<(Src & { pages: PreviewPage[] }) | null>(null);
  const step = ref<'choose' | 'final'>('choose');
  const choice = reactive<Record<string, PageChoice>>({});
  const merged = reactive<Record<string, string>>({});
  const warnings = ref<string[]>([]);
  // the last saved upload: its root page (the apply step) and whether the pack equalled the project
  const saved = ref<{ rootPageId: string; same: boolean } | null>(null);

  const changed = () => pending.value?.pages.filter((p) => p.kind === 'changed') ?? [];

  async function send(src: Src, resolve: Record<string, unknown>, same: boolean) {
    const r = await call<Uploaded>('POST', 'packs/upload', { projectId, ...src, resolve });
    // a page changed between the preview and the save: the upload asks again — preview again
    if (r.status === 'conflict') return start(src);
    pending.value = null;
    saved.value = r.rootPageId ? { rootPageId: r.rootPageId, same } : null;
    await onLoaded();
  }

  async function start(src: Src): Promise<void> {
    const r = await call<{ pages: PreviewPage[] }>('POST', 'packs/preview', { projectId, ...src });
    for (const k of Object.keys(choice)) delete choice[k];
    for (const k of Object.keys(merged)) delete merged[k];
    warnings.value = [];
    step.value = 'choose';
    if (!r.pages.some((p) => p.kind === 'changed')) {
      // nothing to choose: the new pages (if any) are created as they are
      pending.value = null;
      return send(src, {}, !r.pages.length);
    }
    for (const p of r.pages) if (p.kind === 'changed') choice[p.key] = defaultChoice(p);
    pending.value = { ...src, pages: r.pages };
  }

  /** «Load from the catalog» / a zip: the preview; with no changed page the upload goes at once. */
  const upload = (src: Src) =>
    guard(async () => {
      saved.value = null;
      await start(src);
    });

  /** To the final texts: one merge request for all the pages chosen «merge». */
  const next = () =>
    guard(async () => {
      const p = pending.value!;
      const keys = changed()
        .filter((x) => choice[x.key] === 'merge')
        .map((x) => x.key);
      warnings.value = [];
      if (keys.length) {
        const r = await call<{ merged: Record<string, string>; warnings: string[] }>(
          'POST',
          'packs/merge',
          { projectId, packKey: p.packKey, zip: p.zip, title: p.title, keys },
        );
        Object.assign(merged, r.merged);
        warnings.value = r.warnings;
      }
      step.value = 'final';
    });

  /** The text the page gets on save. */
  const finalText = (p: PreviewPage) =>
    choice[p.key] === 'keep'
      ? (p.current ?? '')
      : choice[p.key] === 'merge'
        ? (merged[p.key] ?? '')
        : p.incoming;

  const save = () =>
    guard(async () => {
      const p = pending.value!;
      const resolve = Object.fromEntries(
        changed().map((x) => [
          x.key,
          choice[x.key] === 'merge' ? { merged: merged[x.key] } : choice[x.key],
        ]),
      );
      await send(p, resolve, false);
    });

  const back = () => {
    step.value = 'choose';
  };
  const cancel = () => {
    pending.value = null;
  };
  return {
    pending,
    step,
    choice,
    merged,
    warnings,
    saved,
    changed,
    upload,
    next,
    finalText,
    save,
    back,
    cancel,
  };
}
export type PackUpload = ReturnType<typeof usePackUpload>;
