import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { TooltipProvider } from 'reka-ui';
import { describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { db, i18n, ids, setup, wait } from './setup';
import GeneralSettings from '../GeneralSettings.vue';

vi.mock('../../../ui/EmojiPicker.vue', () => ({
  default: {
    emits: ['pick'],
    template: '<button data-testid="stub-pick" @click="$emit(\'pick\', \'🚀\')">pick</button>',
  },
}));

setup();

describe('PJ-6 выбор эмодзи в настройках узла', () => {
  it('PJ-6: кнопка рядом с полем открывает выбор, эмодзи сохраняется и выбор закрывается', async () => {
    const w = mount(
      {
        render: () =>
          h(TooltipProvider, null, () =>
            h(GeneralSettings, { level: 'space', spaceId: ids.space }),
          ),
      },
      { global: { plugins: [i18n] }, attachTo: document.body },
    );
    await flushPromises();
    await wait();
    expect(document.body.querySelector('[data-testid=stub-pick]')).toBeNull();
    await w.find('[data-testid=general-icon-pick]').trigger('click');
    await wait();
    const stub = document.body.querySelector<HTMLElement>('[data-testid=stub-pick]');
    expect(stub).toBeTruthy();
    stub!.click();
    await wait();
    expect((await db.table('spaces').get(ids.space)).icon).toBe('🚀');
    expect(document.body.querySelector('[data-testid=stub-pick]')).toBeNull();
    w.unmount();
  });
});
