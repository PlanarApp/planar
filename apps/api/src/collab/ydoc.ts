import { getSchema } from '@tiptap/core';
import { serverExtensions } from '@planar/editor';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import type * as Y from 'yjs';

/** Поле Yjs (P3-collab): XmlFragment `default`. */
export const FIELD = 'default';
export type Json = Record<string, unknown>;

const schema = getSchema(serverExtensions());

const isEmpty = (j: Json): boolean => {
  const c = j.content as Json[] | undefined;
  return (
    !c?.length || (c.length === 1 && c[0]!.type === 'paragraph' && !(c[0]!.content as [])?.length)
  );
};

/** Канонический JSON схемы (атрибуты по умолчанию, порядок ключей); пустой документ → null. Неизвестный узел → исключение. */
export function normalize(j: Json | null | undefined): Json | null {
  if (!j || isEmpty(j)) return null;
  return schema.nodeFromJSON(j).toJSON() as Json;
}

/** Содержимое равно без учёта формы записи (пустой документ = null, порядок ключей jsonb). */
export function same(a: Json | null | undefined, b: Json | null | undefined): boolean {
  try {
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
  } catch {
    return false;
  }
}

/** Заменяет содержимое `default` на json одной Y-транзакцией (вызывать внутри doc.transact). */
export function fill(doc: Y.Doc, json: Json | null): void {
  const frag = doc.getXmlFragment(FIELD);
  frag.delete(0, frag.length);
  const n = normalize(json);
  if (n) prosemirrorJSONToYXmlFragment(schema, n, frag);
}

export const toJson = (doc: Y.Doc): Json | null =>
  normalize(yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(FIELD)) as Json);
