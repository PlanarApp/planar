import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import type { Extensions } from '@tiptap/core';
import { cursorColor } from './index.js';

export type Collab = {
  extensions: Extensions;
  provider: HocuspocusProvider;
  /** Сервер открыл документ только для чтения. */
  readOnly: () => boolean;
  destroy: () => void;
};

/** Подключение документа `name` к /collab того же origin + офлайн-хранилище (P3-ydoc «Клиент»). Отдельный модуль: yjs/hocuspocus грузятся лениво. */
export function openCollab(name: string, user: { id: string; name: string }): Collab {
  const ydoc = new Y.Doc();
  const idb = new IndexeddbPersistence(name, ydoc);
  const provider = new HocuspocusProvider({
    url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`,
    name,
    document: ydoc,
  });
  return {
    extensions: [
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({
        provider,
        user: { name: user.name, color: cursorColor(user.id) },
      }),
    ],
    provider,
    readOnly: () => provider.authorizedScope === 'readonly',
    destroy: () => {
      provider.destroy();
      void idb.destroy();
      ydoc.destroy();
    },
  };
}
