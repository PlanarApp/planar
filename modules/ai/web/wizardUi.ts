// Pure logic of the AI setup wizard (SetupWizard.vue): step order and when a step may be left.
export const WIZARD_STEPS = ['key', 'template', 'pack', 'harness'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface WizardState {
  /** the project has an own or inherited connection (a saved key counts) */
  connected: boolean;
  packKey: string;
  prompt: string;
  /** the pack is laid out in the project docs and no page conflicts are left unresolved */
  uploaded: boolean;
}

export const stepIndex = (s: WizardStep): number => WIZARD_STEPS.indexOf(s);

/** Next step, or the same one at the end. */
export const nextStep = (s: WizardStep): WizardStep =>
  WIZARD_STEPS[Math.min(stepIndex(s) + 1, WIZARD_STEPS.length - 1)]!;
export const prevStep = (s: WizardStep): WizardStep => WIZARD_STEPS[Math.max(stepIndex(s) - 1, 0)]!;

/** Whether «Next» is enabled; the last step ends with «Apply», not «Next». The adaptation inside «pack» may be skipped. */
export function canAdvance(s: WizardStep, st: WizardState): boolean {
  if (s === 'key') return st.connected;
  if (s === 'template') return !!st.packKey && !!st.prompt.trim();
  if (s === 'pack') return st.uploaded;
  return false;
}

// «Adapt with AI» (step 3): POST /api/ai/wizard/adapt[/apply] — a proposal as a line diff, then the apply.
export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };
export type Proposal = { body: string; baseUpdatedAt: string; diff: DiffLine[] };
export type AdaptReply = { reply: string; proposal: Proposal | null };

export const diffPrefix = (t: DiffLine['type']): string =>
  t === 'add' ? '+' : t === 'del' ? '-' : ' ';

/** A proposal that changes nothing (only «same» lines) is not worth showing. */
export const hasChanges = (p: Proposal | null): p is Proposal =>
  !!p && p.diff.some((l) => l.type !== 'same');

/** What the apply error means for the UI: 409 → re-request, 403 → no rights. */
export const applyFailure = (status: number | undefined): 'changed' | 'forbidden' | 'other' =>
  status === 409 ? 'changed' : status === 403 ? 'forbidden' : 'other';
