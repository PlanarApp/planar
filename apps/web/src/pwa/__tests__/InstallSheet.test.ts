import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import InstallSheet from '../InstallSheet.vue';

vi.mock('../register', () => ({
  useRegisterSW: () => ({ needRefresh: ref(false), updateServiceWorker: vi.fn(async () => {}) }),
}));
const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, ru } });
const prompt = vi.fn(async () => {});
const fire = () =>
  window.dispatchEvent(
    Object.assign(new Event('beforeinstallprompt'), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    }),
  );

describe('PLNRAPP-67 InstallSheet', () => {
  it('без возможности установки — закрыт; beforeinstallprompt — открывается, «Установить» вызывает prompt; один раз за загрузку', async () => {
    const w = mount(InstallSheet, { attachTo: document.body, global: { plugins: [i18n] } });
    await flushPromises();
    expect(document.querySelector('[data-testid=install-sheet]')).toBeNull();
    fire();
    await flushPromises();
    expect(document.querySelector('[data-testid=install-sheet]')).not.toBeNull();
    const btn = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === en.pwa.install,
    )!;
    btn.click();
    await flushPromises();
    expect(prompt).toHaveBeenCalled();
    expect(document.querySelector('[data-testid=install-sheet]')).toBeNull();
    w.unmount();
    // a remount (another screen) in the same load does not offer again
    fire();
    const w2 = mount(InstallSheet, { attachTo: document.body, global: { plugins: [i18n] } });
    await flushPromises();
    expect(document.querySelector('[data-testid=install-sheet]')).toBeNull();
    w2.unmount();
  });
});
