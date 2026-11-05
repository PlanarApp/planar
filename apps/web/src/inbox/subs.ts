// "My work" sections (?w): «My day» first, default — "Assigned", "Summary" — at the end
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
  WORK_SUBS.includes(w as WorkSub) ? (w as WorkSub) : 'assigned';
