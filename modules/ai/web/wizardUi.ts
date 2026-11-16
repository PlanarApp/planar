// Pure logic of the AI setup wizard (SetupWizard.vue): step order and when a step may be left.
import { AI_BOT_LOGIN } from '../shared/index.js';

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

/** «Adapt with AI» (step 3) is an assignment: the prompt as a page comment (a paragraph per line) for the AI bot. */
export const assignmentBody = (text: string) => ({
  type: 'doc',
  content: text
    .trim()
    .split(/\r?\n/)
    .map((l) => ({ type: 'paragraph', ...(l ? { content: [{ type: 'text', text: l }] } : {}) })),
});

/** The AI bot: login AI_BOT_LOGIN (the server looks it up the same way); other bots (automation) don't count. */
export function aiBotOf<U extends { login?: string; bot?: boolean }>(
  users: ReadonlyArray<U | undefined>,
): U | undefined {
  return users.find((u) => u?.bot && u.login === AI_BOT_LOGIN);
}
