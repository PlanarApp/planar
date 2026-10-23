import { describe, expect, it, vi } from 'vitest';
import { CoreService } from '../../src/core.service.js';
import { JobsService } from '../../src/jobs/jobs.js';
import { getApp, useApp } from '../auth/harness.js';

useApp();

describe('wk15: CoreService через Nest DI', () => {
  it('wk15: enqueue доходит до JobsService (инъекция явная, не no-op)', async () => {
    const jobs = getApp().get(JobsService);
    const spy = vi.spyOn(jobs, 'enqueue').mockResolvedValue();
    await getApp().get(CoreService).enqueue('wk15t.job', { n: 1 });
    expect(spy).toHaveBeenCalledWith('wk15t.job', { n: 1 }, undefined);
  });
});
