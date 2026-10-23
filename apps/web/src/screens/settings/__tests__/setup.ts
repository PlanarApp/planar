import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeAll, beforeEach } from 'vitest';
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

/** Реплика из tasks/__tests__/data; ann — admin пространства. */
export function setup() {
  beforeAll(() => registerMutators(domainMutators));
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
  await new Promise((r) => setTimeout(r, 120));
  await flushPromises();
  return w;
}
export const wait = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await flushPromises();
};

/** Открыть Select (reka: pointerdown) и выбрать пункт по номеру или тексту. */
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
