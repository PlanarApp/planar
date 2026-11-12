// Pure logic of the doc-chat panel (docPanels 'docChat'); API contract: POST /api/ai/doc-chat[/apply].
export type ChatMsg = { role: 'user' | 'assistant'; text: string };
export type DiffLine = { type: 'same' | 'add' | 'del'; text: string };
export type Proposal = { body: string; baseUpdatedAt: string; diff: DiffLine[] };
export type ChatReply = { reply: string; proposal: Proposal | null };

/** History sent with a request: the last `max` messages, empty texts dropped. */
export const trimHistory = (h: ChatMsg[], max = 20): ChatMsg[] =>
  h.filter((m) => m.text.trim()).slice(-max);

export const diffPrefix = (t: DiffLine['type']): string =>
  t === 'add' ? '+' : t === 'del' ? '-' : ' ';

/** A proposal that changes nothing (only «same» lines) is not worth showing. */
export const hasChanges = (p: Proposal | null): p is Proposal =>
  !!p && p.diff.some((l) => l.type !== 'same');

/** What the apply error means for the UI: 409 → re-request, 403 → no rights. */
export const applyFailure = (status: number | undefined): 'changed' | 'forbidden' | 'other' =>
  status === 409 ? 'changed' : status === 403 ? 'forbidden' : 'other';
