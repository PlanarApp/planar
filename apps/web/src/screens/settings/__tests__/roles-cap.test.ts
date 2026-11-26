// roles audit 2026-11-26: the members form does not offer a role above the instance role
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { UserPicker } from '../../../pickers';
import { Select } from '../../../ui';
import { db, ids, setup, show, wait } from './setup';
import MembersSettings from '../MembersSettings.vue';

setup();

describe('settings:members, потолок роли', () => {
  it('гость инстанса — в форме только guest; обычный пользователь — три роли', async () => {
    await db.table('spaceMembers').where('userId').equals(ids.bob).delete();
    await db.table('users').update(ids.bob, { deactivatedAt: null, role: 'guest' });
    const w = await show(MembersSettings);
    const options = () =>
      (w.findAllComponents(Select)[0]!.props('options') as { value: string }[]).map((o) => o.value);
    expect(options()).toEqual(['admin', 'member', 'guest']);
    w.getComponent(UserPicker).vm.$emit('pick', ids.bob);
    await wait();
    expect(options()).toEqual(['guest']);
  });
});
