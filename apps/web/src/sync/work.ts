// PLNRAPP-884: signals of background work from the server (WS `work`) — the client reloads that work instead of
// polling it. A bus of its own: the sync client feeds it, the activity sources listen.

/**
 * Background work of a row changed (an AI run of a task). entity '*' — the connection was restored: signals could
 * have been missed, reload all.
 */
export interface WorkEvent {
  entity: string;
  id: string;
  projectId: string | null;
}

const cbs = new Set<(e: WorkEvent) => void>();

export function onWork(cb: (e: WorkEvent) => void): () => void {
  cbs.add(cb);
  return () => void cbs.delete(cb);
}

export function emitWork(e: WorkEvent): void {
  for (const cb of [...cbs])
    try {
      cb(e);
    } catch (err) {
      console.error(err);
    }
}
