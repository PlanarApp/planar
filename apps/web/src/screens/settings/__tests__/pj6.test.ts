import 'fake-indexeddb/auto';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { TooltipProvider } from 'reka-ui';
import { describe, expect, it, vi } from 'vitest';
import { h } from 'vue';
import { db, i18n, ids, setup, wait } from './setup';
import GeneralSettings from '../GeneralSettings.vue';
import { Select } from '../../../ui';

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

describe('PLANARAPP-3/4 руководитель и исполнитель по умолчанию', () => {
  let w: VueWrapper;
  // the Select of a testid block: offered people, then pick one
  const select = (testid: string) => w.get(`[data-testid=${testid}]`).getComponent(Select);
  const pick = async (testid: string, userId: string) => {
    select(testid).vm.$emit('update:modelValue', userId);
    await wait();
  };
  const mountAt = async (props: Record<string, unknown>) => {
    w = mount(
      { render: () => h(TooltipProvider, null, () => h(GeneralSettings, props)) },
      { global: { plugins: [i18n] }, attachTo: document.body },
    );
    await flushPromises();
    await wait();
  };

  it('проект: руководитель и исполнитель по умолчанию сохраняются', async () => {
    await mountAt({ level: 'project', spaceId: ids.space, projectId: ids.project });
    // members of the space only (Bob of the fixture is deactivated) and «nobody»
    const offered = () =>
      (select('general-default-assignee').props('options') as { value: string }[]).map(
        (o) => o.value,
      );
    await vi.waitFor(() => expect(offered()).toEqual(['__none', ids.ann]));
    await pick('general-default-assignee', ids.ann);
    expect((await db.table('projects').get(ids.project)).defaultAssigneeId).toBe(ids.ann);
    await pick('general-lead', ids.ann);
    expect((await db.table('projects').get(ids.project)).leadId).toBe(ids.ann);
    await pick('general-lead', '__none');
    expect((await db.table('projects').get(ids.project)).leadId).toBeNull();
    w.unmount();
  });

  it('PLANARAPP-33 проект: ключ виден и меняется; неверный и занятый — ошибка без записи', async () => {
    await mountAt({ level: 'project', spaceId: ids.space, projectId: ids.project });
    const input = () => w.get<HTMLInputElement>('input[data-testid=general-key]');
    await vi.waitFor(() => expect(input().element.value).toBe('PLN'));
    const set = async (v: string) => {
      await input().setValue(v);
      await input().trigger('change');
      await wait();
    };
    const key = async () => (await db.table('projects').get(ids.project)).key;
    await set('1x');
    expect(w.text()).toContain('2–10 символов');
    expect(await key()).toBe('PLN');
    await set('OLD');
    expect(w.text()).toContain('Такой ключ уже занят');
    expect(await key()).toBe('PLN');
    await set('new');
    expect(await key()).toBe('NEW');
    w.unmount();
  });

  it('пространство: только руководитель', async () => {
    await mountAt({ level: 'space', spaceId: ids.space });
    expect(w.find('[data-testid=general-default-assignee]').exists()).toBe(false);
    await pick('general-lead', ids.ann);
    expect((await db.table('spaces').get(ids.space)).leadId).toBe(ids.ann);
    w.unmount();
  });
});
