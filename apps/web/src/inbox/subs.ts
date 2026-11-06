// "My work" sections (?w) — tabs of the section (PLNRAPP-84): default — «My day», "Summary" — at the end
export const WORK_SUBS = [
  'day',
  'assigned',
  'comments',
  'mentions',
  'created',
  'watched',
  'activity',
  'summary',
] as const;
export type WorkSub = (typeof WORK_SUBS)[number];

export const workSub = (w: unknown): WorkSub =>
  WORK_SUBS.includes(w as WorkSub) ? (w as WorkSub) : 'day';
