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
  /** Вызывается после каждой успешной аутентификации (в т.ч. после переподключения). */
  onAuthenticated: (cb: () => void) => void;
  /** Сервер открыл документ только для чтения. */
  /** Доступ так и не получен после повторов: редактор нужно сделать нередактируемым. */
  onDenied: (cb: () => void) => void;
  readOnly: () => boolean;
  destroy: () => void;
};

const RETRIES = 5;
const RETRY_MS = 2000;

/** Подключение документа `name` к /collab того же origin + офлайн-хранилище (P3-ydoc «Клиент»). Отдельный модуль: yjs/hocuspocus грузятся лениво. */
export function openCollab(name: string, user: { id: string; name: string }): Collab {
  const ydoc = new Y.Doc();
  const idb = new IndexeddbPersistence(name, ydoc);
  const awareness = new Awareness(ydoc);
  const color = cursorColor(user.id);
  // provider.destroy() уничтожает awareness: при повторах он нужен живым (на нём курсоры), гасим вручную в destroy()
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
    // страница/задача могла быть создана только что и ещё не дойти до сервера (отказ в доступе):
    // провайдер после отказа не восстанавливается, поэтому создаём новый на тех же ydoc и awareness
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
