import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { domainMutators } from '@planar/shared';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { useAuth, type User } from '../../../auth/useAuth';
import { db, registerMutators, startSync, stopSync } from '../../../sync';
import { ids, reset } from '../../../tasks/__tests__/data';

export { ids, db };
export const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});

/** Replica from tasks/__tests__/data; ann — the space admin. */
export function setup() {
  beforeAll(() => registerMutators(domainMutators));
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await stopSync();
    await reset();
    await db.table('spaceMembers').where('userId').equals(ids.ann).modify({ role: 'admin' });
    await startSync({
      userId: ids.ann,
      fetch: (() => Promise.reject(new TypeError('offline'))) as never,
    });
    await db._queue.clear();
    useAuth().user.value = { id: ids.ann, role: 'member' } as User;
  });
}

export async function show(comp: object, props: Record<string, unknown> = { spaceId: ids.space }) {
  const w = mount(comp, { props, global: { plugins: [i18n] }, attachTo: document.body });
  await flushPromises();
  // the screen loads data from the replica asynchronously: wait until the markup stops changing
  let prev = '';
  await vi.waitFor(async () => {
    await flushPromises();
    const cur = w.html();
    const stable = cur !== '' && cur === prev;
    prev = cur;
    expect(stable).toBe(true);
  });
  return w;
}
export const wait = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await flushPromises();
};

/** Open Select (reka: pointerdown) and pick an item by number or text. */
export async function pick(trigger: Element, option: number | string = 0) {
  trigger.dispatchEvent(
    new PointerEvent('pointerdown', { button: 0, bubbles: true, pointerType: 'mouse' }),
  );
  await wait();
  const opts = [...document.body.querySelectorAll('[role=option]')] as HTMLElement[];
  const o =
    typeof option === 'number' ? opts[option] : opts.find((x) => x.textContent?.includes(option));
  o!.dispatchEvent(
    new PointerEvent('pointerup', { button: 0, bubbles: true, pointerType: 'mouse' }),
  );
  o!.click();
  await wait();
}

/** Open the row menu "…" (reka: keydown Enter), pick an item; confirm — press confirm in the dialog. */
export async function menuAct(trigger: Element, item: string, confirm = false) {
  trigger.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  const find = () =>
    [...document.body.querySelectorAll<HTMLElement>('[role=menuitem]')].find((x) =>
      x.textContent?.includes(item),
    );
  await vi.waitFor(() => expect(find()).toBeTruthy());
  find()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait();
  if (!confirm) return;
  await vi.waitFor(() => expect(document.body.querySelector('[role=dialog] button')).toBeTruthy());
  [...document.body.querySelectorAll<HTMLElement>('[role=dialog] button')].at(-1)!.click(); // "cancel" first, confirmation last
  await wait();
}
