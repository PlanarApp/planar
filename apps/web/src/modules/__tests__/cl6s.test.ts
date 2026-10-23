import { describe, expect, it } from 'vitest';
import * as sdk from '../sdk';

describe('cl6s', () => {
  it('cl6s: SDK экспортирует модульные API (C-modules v5, collab §X-core п. 6)', () => {
    for (const k of [
      'Editor',
      'uploadFile',
      'api',
      'ApiError',
      'sendTyping',
      'onTyping',
      'onMutationError',
      'useSearch',
    ])
      expect(sdk, k).toHaveProperty(k);
  });
});
