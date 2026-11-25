import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { until } from '../../tasks/__tests__/data';
import { useLive } from '../live';

describe('useLive: initial', () => {
  it('при смене ключа значение из initial вместо undefined', async () => {
    const key = ref('a');
    const seen: unknown[] = [];
    const scope = effectScope();
    const r = scope.run(() =>
      useLive(
        key,
        async (k) => k.toUpperCase(),
        (k) => (k === 'b' ? 'cached-b' : undefined),
      ),
    )!;
    await until(() => r.value === 'A');
    key.value = 'b';
    seen.push(r.value);
    await until(() => r.value === 'B');
    expect(seen).toEqual(['cached-b']);
    scope.stop();
  });
});
