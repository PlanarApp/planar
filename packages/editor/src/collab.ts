import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Extensions } from '@tiptap/core';
import { cursorColor } from './index.js';

export type Collab = {
  extensions: Extensions;
  /** Called after each successful authentication (including after a reconnect). */
  onAuthenticated: (cb: () => void) => void;
  /** The server opened the document read-only. */
  /** Access not obtained after retries: edits pile up in IndexedDB, «not synced» must be shown. */
  onDenied: (cb: () => void) => void;
  /** A new series of connection attempts. */
  retry: () => void;
  readOnly: () => boolean;
  destroy: () => void;
};

const RETRIES = 5;
const RETRY_MS = 2000;

/** Connects document `name` to /collab of the same origin + offline storage (P3-ydoc «Client»). A separate module: yjs/hocuspocus are loaded lazily. */
export function openCollab(name: string, user: { id: string; name: string }): Collab {
  const ydoc = new Y.Doc();
  const idb = new IndexeddbPersistence(name, ydoc);
  const awareness = new Awareness(ydoc);
  const color = cursorColor(user.id);
  // provider.destroy() destroys awareness: on retries it must stay alive (cursors live on it), so we turn it off manually in destroy()
  const realDestroy = awareness.destroy.bind(awareness);
  awareness.destroy = () => {};
  const listeners: (() => void)[] = [];
  const denied: (() => void)[] = [];
  let provider: HocuspocusProvider;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let gone = false;
  const connect = () => {
    provider = new HocuspocusProvider({
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`,
      name,
      document: ydoc,
      awareness,
    });
    awareness.setLocalState({ ...awareness.getLocalState(), user: { name: user.name, color } });
    provider.on('authenticated', () => listeners.forEach((f) => f()));
    // the page/task could have just been created and not yet reached the server (access refusal):
    // the provider is not restored after a refusal, so we create a new one on the same ydoc and awareness
    provider.on('authenticationFailed', () => {
      if (gone) return;
      if (++tries > RETRIES) return denied.forEach((f) => f());
      timer = setTimeout(() => {
        provider.destroy();
        connect();
      }, RETRY_MS);
    });
  };
  connect();
  return {
    extensions: [
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({
        provider: { awareness } as never,
        user: { name: user.name, color },
      }),
    ],
    onAuthenticated: (cb) => void listeners.push(cb),
    onDenied: (cb) => void denied.push(cb),
    retry: () => {
      tries = 0;
      clearTimeout(timer);
      provider.destroy();
      connect();
    },
    readOnly: () => provider.authorizedScope === 'readonly',
    destroy: () => {
      gone = true;
      clearTimeout(timer);
      provider.destroy();
      realDestroy();
      void idb.destroy();
      ydoc.destroy();
    },
  };
}
